import {uid} from './core.js';
import {GALAXY_CAMPAIGN_KEY,isCampaignProgress} from './galaxy-campaign.js';
import {RADIO_VOLUME_KEY,validRadioVolume} from './radio.js';
import {fs, state, transaction, transactionStores} from './storage.js';

export const WORKSPACE_BACKUP_EXTENSION = '.greenos';
const FORMAT = 'greenos-workspace';
const VERSION = 1;
const MAGIC = new TextEncoder().encode('GREENOS-WORKSPACE');
const HEADER_SIZE = MAGIC.length + 8;
const MIB = 1024 * 1024;
const MAX_MANIFEST = 16 * MIB;
const MAX_ARCHIVE = 8 * 1024 * MIB;
const MAX_FILES = 10_000;
const MAX_PARTS = 20_000;
const JOURNAL = 'workspace-restore-journal-v1';
const LOCK = 'greenos-workspace-backup-v1';
const SESSION_LOCK = 'greenos-workspace-session-v1';
const SETTINGS = 'greenos-settings-v2';
const WORLDS = ['greenos-greenblocks-expedition-v1', 'greenos-greenblocks-v1'];
const ORIGINAL_LOCAL_KEYS = [SETTINGS, ...WORLDS, 'greenos-greenblocks-mode', 'greenos-galaxy-best-v1', 'greenos-notes'];
const LOCAL_KEYS = [...ORIGINAL_LOCAL_KEYS, RADIO_VOLUME_KEY, GALAXY_CAMPAIGN_KEY];
const STATE_KEYS = new Set(['session', 'profile-avatar', 'desktop-wallpapers']);
const PROFILES = ['buildroot', 'tinycore', 'custom'];
const LINUX_KEYS = new Set(PROFILES.map(profile => 'vm-checkpoint-' + profile));
const DRAFT_KEY = /^office-draft-(meta|data|base):([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const SYSTEM_FOLDERS = ['home', 'desktop', 'documents', 'downloads', 'pictures', 'shared'];
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const WORD_IMAGES = new Set([...IMAGE_TYPES,'image/gif','image/bmp']);
const PART_TYPES = new Set(['blob', 'bytes', 'buffer']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const utf8 = new TextDecoder('utf-8', {fatal: true});
const preparedBackups = new WeakMap();
let sessionLease;

const crcTable = Uint32Array.from({length:256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function crcUpdate(crc, bytes) {
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
  return crc;
}

async function blobCrc(blob) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      crc = crcUpdate(crc, value);
    }
  } finally {
    reader.releaseLock();
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function valid(condition, message = 'Резервная копия GreenOS повреждена.') {
  if (!condition) throw new Error(message);
}

function record(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value, max) {
  return typeof value === 'string' && value.length <= max;
}

function count(value, max) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function dateValue(value) {
  return Number.isFinite(value) && Math.abs(value) <= 8.64e15;
}

function managedKey(key, includeLinux) {
  return typeof key === 'string' && (STATE_KEYS.has(key) || DRAFT_KEY.test(key) || includeLinux && LINUX_KEYS.has(key));
}

function readLocal() {
  return Object.fromEntries(LOCAL_KEYS.map(key => [key, localStorage.getItem(key)]));
}

function writeLocal(snapshot, keys = LOCAL_KEYS) {
  for (const key of keys) localStorage.removeItem(key);
  for (const key of keys) if (snapshot[key] != null) localStorage.setItem(key, snapshot[key]);
}

function workspaceLock(action) {
  return navigator.locks?.request ? navigator.locks.request(LOCK, action) : action();
}

export function startWorkspaceSession() {
  if (!navigator.locks?.request) return Promise.resolve();
  if (sessionLease) return sessionLease.ready;
  const lease = {};
  const hold = new Promise(resolve => { lease.release = resolve; });
  sessionLease = lease;
  lease.ready = new Promise((resolve, reject) => {
    lease.held = navigator.locks.request(SESSION_LOCK, {mode:'shared'}, () => {
      resolve();
      return hold;
    }).catch(error => {
      if (sessionLease === lease) sessionLease = undefined;
      reject(error);
    });
  });
  return lease.ready;
}

async function replaceWithExclusiveLock(action) {
  if (!navigator.locks?.request) return action();
  const previous = sessionLease;
  sessionLease = undefined;
  previous?.release();
  await previous?.held;
  let restored = false;
  try {
    await new Promise((resolve, reject) => {
      navigator.locks.request(SESSION_LOCK, {mode:'exclusive',ifAvailable:true}, async lock => {
        if (!lock) {
          reject(new Error('Закройте другие вкладки GreenOS и повторите восстановление.'));
          return;
        }
        await action();
        restored = true;
        resolve();
        // Navigation releases this lease; until then, no other tab may start with stale state.
        await new Promise(() => {});
      }).catch(reject);
    });
  } finally {
    if (!restored && previous) await startWorkspaceSession();
  }
}

function parseJson(textValue) {
  try { return JSON.parse(textValue); }
  catch { throw new Error('Повреждены данные в резервной копии GreenOS.'); }
}

function encode(value, parts, depth = 0) {
  valid(depth <= 64, 'Слишком сложная структура резервной копии.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    valid(Number.isFinite(value));
    return value;
  }
  if (value instanceof Blob || value instanceof Uint8Array || value instanceof ArrayBuffer) {
    valid(parts.length < MAX_PARTS, 'Слишком много вложений в резервной копии.');
    const index = parts.length;
    const type = value instanceof Blob ? 'blob' : value instanceof Uint8Array ? 'bytes' : 'buffer';
    parts.push({type, blob: type === 'blob' ? value : new Blob([value])});
    return {$greenosPart: index};
  }
  if (Array.isArray(value)) return Array.from(value, item => encode(item ?? null, parts, depth + 1));
  valid(record(value) && !Object.hasOwn(value, '$greenosPart'), 'Не удалось перенести запись из хранилища GreenOS.');
  const entries = [];
  for (const [key, item] of Object.entries(value)) {
    valid(!DANGEROUS_KEYS.has(key));
    if (item !== undefined) entries.push([key, encode(item, parts, depth + 1)]);
  }
  return Object.fromEntries(entries);
}

async function decode(value, parts, used, depth = 0) {
  valid(depth <= 64);
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const list = [];
    for (const item of value) list.push(await decode(item, parts, used, depth + 1));
    return list;
  }
  valid(record(value));
  if (Object.hasOwn(value, '$greenosPart')) {
    const index = value.$greenosPart;
    valid(Object.keys(value).length === 1 && count(index, parts.length - 1) && !used.has(index));
    used.add(index);
    const {type, blob} = parts[index];
    if (type === 'blob') return blob;
    const data = await blob.arrayBuffer();
    return type === 'bytes' ? new Uint8Array(data) : data;
  }
  const entries = [];
  for (const [key, item] of Object.entries(value)) {
    valid(!DANGEROUS_KEYS.has(key));
    entries.push([key, await decode(item, parts, used, depth + 1)]);
  }
  return Object.fromEntries(entries);
}

function knownLocalKeys(local) {
  return record(local) && ORIGINAL_LOCAL_KEYS.every(key => Object.hasOwn(local,key))
    && Object.keys(local).every(key => LOCAL_KEYS.includes(key));
}

function validateLocal(local) {
  valid(knownLocalKeys(local));
  for (const value of Object.values(local)) valid(value === null || text(value, 8 * MIB));
  if (local[SETTINGS] !== null) {
    const value = parseJson(local[SETTINGS]);
    valid(record(value) && !Object.keys(value).some(key => DANGEROUS_KEYS.has(key)));
    const types = {name:'string', theme:'string', wallpaper:'string', accent:'string', animations:'boolean',
      startupSound:'boolean', workspace:'number', ram:'number', profile:'string', welcome:'boolean'};
    for (const [key, type] of Object.entries(types)) valid(!Object.hasOwn(value, key) || typeof value[key] === type);
    if (Object.hasOwn(value, 'shortcuts')) {
      valid(Array.isArray(value.shortcuts) && value.shortcuts.length <= MAX_FILES);
      for (const item of value.shortcuts) {
        valid(record(item) && ['home','trash','app','file'].includes(item.kind) && text(item.id,180)
          && count(item.col,MAX_FILES) && count(item.row,MAX_FILES));
      }
    }
  }
  for (const key of WORLDS) {
    if (local[key] === null) continue;
    const save = parseJson(local[key]);
    valid(record(save) && save.version === 1 && Number.isInteger(save.seed) && Array.isArray(save.edits));
  }
  if (local['greenos-greenblocks-mode'] !== null) {
    valid(['expedition', 'creative'].includes(local['greenos-greenblocks-mode']));
  }
  if (local['greenos-galaxy-best-v1'] !== null) {
    valid(/^\d{1,16}$/.test(local['greenos-galaxy-best-v1']));
  }
  if (local[RADIO_VOLUME_KEY] != null) valid(validRadioVolume(local[RADIO_VOLUME_KEY]));
  if (local[GALAXY_CAMPAIGN_KEY] != null) valid(isCampaignProgress(parseJson(local[GALAXY_CAMPAIGN_KEY])));
}

function validateFiles(files) {
  valid(Array.isArray(files) && files.length <= MAX_FILES);
  const nodes = new Map(), paths = new Map();
  for (const node of files) {
    valid(record(node) && text(node.id,180) && node.id.length > 0 && !nodes.has(node.id)
      && ['file','dir'].includes(node.type) && dateValue(node.modified) && text(node.name,180));
    fs.validateName(node.name);
    valid(node.trashRoot === undefined || typeof node.trashRoot === 'boolean');
    if (node.type === 'file') {
      valid(node.data instanceof Uint8Array && node.data.byteLength <= 32 * MIB && text(node.mime,256));
    } else valid(node.data === undefined);
    nodes.set(node.id, node);
  }
  for (const id of SYSTEM_FOLDERS) {
    const node = nodes.get(id);
    valid(node?.type === 'dir' && !node.trashRoot && node.parent === (id === 'home' ? null : 'home'),
      'В резервной копии отсутствуют системные папки GreenOS.');
  }
  const verified = new Set(['home']);
  for (const node of files) {
    if (node.id !== 'home') valid(nodes.get(node.parent)?.type === 'dir');
    if (!node.trashRoot) {
      let siblings = paths.get(node.parent);
      if (!siblings) paths.set(node.parent, siblings = new Set());
      valid(!siblings.has(node.name), 'В резервной копии есть объекты с одинаковым именем.');
      siblings.add(node.name);
    }
    const branch = new Set();
    let current = node;
    while (!verified.has(current.id)) {
      valid(!branch.has(current.id), 'В резервной копии папки образуют цикл.');
      branch.add(current.id);
      current = nodes.get(current.parent);
      valid(current?.type === 'dir');
    }
    for (const id of branch) verified.add(id);
  }
}

function validateImage(blob, limit) {
  return blob instanceof Blob && blob.size > 0 && blob.size <= limit && IMAGE_TYPES.has(blob.type);
}

function validateSession(windows) {
  valid(Array.isArray(windows) && windows.length <= 250);
  for (const item of windows) {
    valid(record(item) && text(item.app,60) && record(item.options) && count(item.workspace,2));
    if (item.app === 'linux') valid(!item.options.autostart && !item.options.restore);
    if (item.geometry) {
      valid(record(item.geometry) && ['x','y','width','height'].every(key => Number.isFinite(item.geometry[key])));
    }
  }
}

function validateDraft(id, {meta, data, base}) {
  valid(record(meta) && meta.version === 1 && meta.id === id && ['docx','xlsx','pptx'].includes(meta.kind)
    && text(meta.name,180) && dateValue(meta.updated) && UUID.test(meta.writer)
    && UUID.test(meta.revision) && typeof meta.hasBase === 'boolean' && record(data) && data.version === 1);
  if (meta.kind === 'docx') {
    valid(!meta.hasBase && base === undefined && text(data.name,180)
      && text(data.html,MAX_MANIFEST) && Array.isArray(data.images) && data.images.length <= MAX_PARTS);
    let bytes = 0;
    const urls = new Set();
    for (const image of data.images) {
      valid(record(image) && text(image.url,2048) && image.url.startsWith('blob:') && !urls.has(image.url)
        && image.blob instanceof Blob && WORD_IMAGES.has(image.blob.type));
      urls.add(image.url);
      bytes += image.blob.size;
      valid(bytes <= 64 * MIB);
    }
  } else {
    valid(meta.hasBase && record(base) && text(base.name,180) && text(base.mime,256)
      && base.data instanceof Uint8Array && base.data.byteLength <= 32 * MIB
      && data.kind === meta.kind && Array.isArray(data.pages) && count(data.index,MAX_PARTS));
  }
}

function validateState(values, includeLinux) {
  valid(record(values));
  const draftRecords = new Map();
  for (const [key, item] of Object.entries(values)) {
    valid(managedKey(key, includeLinux));
    if (key === 'profile-avatar') valid(validateImage(item,10 * MIB));
    else if (key === 'session') validateSession(item);
    else if (key === 'desktop-wallpapers') {
      valid(Array.isArray(item) && item.length <= 12);
      const ids = new Set();
      for (const wallpaper of item) {
        valid(record(wallpaper) && /^wallpaper-[\da-f-]{36}$/.test(wallpaper.id)
          && !ids.has(wallpaper.id) && text(wallpaper.name,100) && validateImage(wallpaper.blob,3 * MIB));
        ids.add(wallpaper.id);
      }
    } else if (LINUX_KEYS.has(key)) {
      valid(record(item) && item.format === 2 && key === 'vm-checkpoint-' + item.profile
        && [128,256,512].includes(item.ram) && dateValue(item.created) && typeof item.compressed === 'boolean'
        && item.blob instanceof Blob && item.blob.size > 0 && item.blob.size <= 1024 * MIB);
      if (item.customImage !== undefined) valid(item.profile === 'custom' && item.customImage instanceof Blob
        && item.customImage.size <= 512 * MIB);
    } else {
      const [, type, id] = DRAFT_KEY.exec(key);
      const entries = draftRecords.get(id) ?? {};
      entries[type] = item;
      draftRecords.set(id, entries);
    }
  }
  valid(draftRecords.size <= 250);
  for (const [id, draft] of draftRecords) validateDraft(id,draft);
}

async function readSnapshot(includeLinux) {
  const values = Object.create(null);
  const local = readLocal();
  const files = await transactionStores(['files','state'], 'readonly', ({files,state}, abort) => {
    const keys = state.openKeyCursor();
    keys.onsuccess = () => {
      const cursor = keys.result;
      if (!cursor) return;
      try {
        const key = cursor.key;
        if (managedKey(key, includeLinux)) {
          const request = state.get(key);
          request.onsuccess = () => { if (request.result !== undefined) values[key] = request.result; };
        }
        cursor.continue();
      } catch (error) { abort(error); }
    };
    return files.getAll();
  });
  return {files, values, local};
}

export async function createWorkspaceBackup({includeLinux = false} = {}) {
  const snapshot = await workspaceLock(() => readSnapshot(Boolean(includeLinux)));
  validateFiles(snapshot.files);
  validateState(snapshot.values, includeLinux);
  validateLocal(snapshot.local);
  const parts = [];
  const manifest = {format:FORMAT, version:VERSION, created:Date.now(), linux:Boolean(includeLinux),
    local:snapshot.local, files:encode(snapshot.files,parts), state:encode(snapshot.values,parts), parts:[]};
  let size = HEADER_SIZE;
  for (const {type, blob} of parts) {
    size += blob.size;
    valid(size <= MAX_ARCHIVE, 'Резервная копия превышает 8 ГБ.');
    manifest.parts.push({type, size:blob.size, mime:blob.type, crc:await blobCrc(blob)});
  }
  const metadata = new TextEncoder().encode(JSON.stringify(manifest));
  valid(metadata.byteLength <= MAX_MANIFEST && size + metadata.byteLength <= MAX_ARCHIVE,
    'Слишком большой объём данных в резервной копии.');
  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC);
  const view = new DataView(header.buffer);
  view.setUint32(MAGIC.length, metadata.byteLength, true);
  view.setUint32(MAGIC.length + 4, (crcUpdate(0xffffffff, metadata) ^ 0xffffffff) >>> 0, true);
  return new Blob([header, metadata, ...parts.map(part => part.blob)], {type:'application/octet-stream'});
}

export async function inspectWorkspaceBackup(file) {
  valid(file instanceof Blob && file.size >= HEADER_SIZE && file.size <= MAX_ARCHIVE,
    'Недопустимый размер резервной копии GreenOS.');
  const header = new Uint8Array(await file.slice(0, HEADER_SIZE).arrayBuffer());
  valid(MAGIC.every((byte, index) => header[index] === byte), 'Это не резервная копия рабочего пространства GreenOS.');
  const view = new DataView(header.buffer);
  const length = view.getUint32(MAGIC.length, true);
  let offset = HEADER_SIZE + length;
  valid(length > 0 && length <= MAX_MANIFEST && offset <= file.size);
  const metadata = new Uint8Array(await file.slice(HEADER_SIZE, offset).arrayBuffer());
  valid(((crcUpdate(0xffffffff, metadata) ^ 0xffffffff) >>> 0) === view.getUint32(MAGIC.length + 4, true));
  const manifest = parseJson(utf8.decode(metadata));
  valid(record(manifest) && manifest.format === FORMAT && manifest.version === VERSION,
    'Версия резервной копии GreenOS не поддерживается.');
  valid(dateValue(manifest.created) && typeof manifest.linux === 'boolean'
    && Array.isArray(manifest.files) && manifest.files.length <= MAX_FILES
    && record(manifest.state) && Array.isArray(manifest.parts) && manifest.parts.length <= MAX_PARTS);
  validateLocal(manifest.local);
  const parts = [];
  for (const part of manifest.parts) {
    valid(record(part) && PART_TYPES.has(part.type) && count(part.size,1024 * MIB) && count(part.crc,0xffffffff)
      && text(part.mime,256) && (part.type === 'blob' || part.size <= 32 * MIB)
      && offset + part.size <= file.size);
    parts.push({type:part.type, crc:part.crc, blob:file.slice(offset, offset + part.size, part.mime)});
    offset += part.size;
  }
  valid(offset === file.size);
  for (const {blob, crc} of parts) {
    valid(await blobCrc(blob) === crc, 'Контрольная сумма не совпадает. Резервная копия повреждена.');
  }
  const used = new Set();
  const files = await decode(manifest.files, parts, used);
  const values = await decode(manifest.state, parts, used);
  valid(used.size === parts.length);
  validateFiles(files);
  validateState(values, manifest.linux);
  const keys = Object.keys(values);
  const summary = Object.freeze({created:manifest.created, size:file.size, files:files.filter(node => node.type === 'file').length,
    folders:files.filter(node => node.type === 'dir').length, officeDrafts:keys.filter(key => key.startsWith('office-draft-meta:')).length,
    wallpapers:values['desktop-wallpapers']?.length ?? 0, linuxSnapshots:keys.filter(key => LINUX_KEYS.has(key)).length,
    includeLinux:manifest.linux});
  const prepared = Object.freeze({summary});
  preparedBackups.set(prepared,{files, values, local:manifest.local, includeLinux:manifest.linux});
  return prepared;
}

export function recoverWorkspaceRestore() {
  return workspaceLock(async () => {
    const previous = await state.get(JOURNAL);
    if (previous === undefined) return false;
    // Restore the previous strings verbatim, including settings that the old app ignored.
    valid(knownLocalKeys(previous) && Object.values(previous).every(value => value === null || typeof value === 'string'));
    writeLocal(previous,Object.keys(previous));
    await state.delete(JOURNAL);
    return true;
  });
}

export function restoreWorkspaceBackup(prepared) {
  const snapshot = preparedBackups.get(prepared);
  valid(snapshot, 'Сначала проверьте резервную копию GreenOS.');
  return workspaceLock(() => replaceWithExclusiveLock(async () => {
    const previous = readLocal();
    await transaction('state','readwrite', store => store.add(previous,JOURNAL));
    try {
      // A crash before the IndexedDB commit leaves this journal for startup rollback.
      writeLocal(snapshot.local);
      await transactionStores(['files','state'], 'readwrite', ({files,state}, abort) => {
        files.clear();
        for (const node of snapshot.files) files.put({...node,revision:uid()});
        const keys = state.getAllKeys();
        keys.onsuccess = () => {
          try {
            for (const key of keys.result) {
              if (managedKey(key,snapshot.includeLinux) && !Object.hasOwn(snapshot.values,key)) state.delete(key);
            }
            for (const [key, value] of Object.entries(snapshot.values)) state.put(value,key);
            state.delete(JOURNAL);
          } catch (error) { abort(error); }
        };
      });
    } catch (error) {
      try {
        writeLocal(previous);
        await state.delete(JOURNAL);
      } catch {
        throw new Error('Не удалось завершить восстановление. Обновите страницу для возврата к прежним данным.',{cause:error});
      }
      throw error;
    }
    preparedBackups.delete(prepared);
    await fs.refresh({broadcast:true}).catch(error => console.warn('Workspace restore file refresh failed',error));
  }));
}
