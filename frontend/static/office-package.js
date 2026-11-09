const MAX_MEMBER = 16 * 1024 * 1024;
const MAX_OUTPUT = 64 * 1024 * 1024;
const MAX_ENTRIES = 8192;
const ZIP32_LIMIT = 0xffffffff;
const UTF8_NAMES = 0x0800;
const DATA_DESCRIPTOR = 0x0008;
const ENCRYPTION = 0x2041;
const signature = {end: 0x06054b50, central: 0x02014b50, local: 0x04034b50};
const utf8 = new TextDecoder();
const encoder = new TextEncoder();
const badArchive = () => new Error('Повреждённый или неподдерживаемый архив Office.');

// Open XML uses ZIP packages. Resolve only local package parts, never external relationships.
function resolvePart(from, target) {
  if (typeof target !== 'string' || /[:\\?#]/.test(target) || target.startsWith('//')) return null;
  try { target = decodeURIComponent(target); } catch { return null; }
  if (/[:\\?#]/.test(target) || target.startsWith('//')) return null;
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

export function children(node, name) {
  return [...(node?.children ?? [])].filter(child => !name || child.localName === name);
}

export function child(node, name) {
  return children(node, name)[0];
}

export function descendants(node, name) {
  return node ? [...node.getElementsByTagNameNS('*', name)] : [];
}

export function attribute(node, name) {
  return [...(node?.attributes ?? [])].find(attr => attr.localName === name)?.value;
}

function indexZip(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const short = at => view.getUint16(at, true);
  const long = at => view.getUint32(at, true);
  let end = data.length - 22;
  const minimum = Math.max(0, end - 65535);
  for (; end >= minimum; end--) {
    if (long(end) === signature.end && end + 22 + short(end + 20) === data.length) break;
  }
  if (end < minimum || short(end + 4) || short(end + 6)) throw badArchive();
  const count = short(end + 10);
  const directoryEnd = long(end + 16) + long(end + 12);
  let cursor = long(end + 16);
  if (count > MAX_ENTRIES || count !== short(end + 8) || directoryEnd > end) throw badArchive();
  const entries = new Map();
  const members = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > directoryEnd || long(cursor) !== signature.central) throw badArchive();
    const nameLength = short(cursor + 28);
    const next = cursor + 46 + nameLength + short(cursor + 30) + short(cursor + 32);
    if (next > directoryEnd) throw badArchive();
    const name = utf8.decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
    const offset = long(cursor + 42), packed = long(cursor + 20), size = long(cursor + 24);
    const method = short(cursor + 10), flags = short(cursor + 8);
    const member = {name, offset, packed, size, method, flags, disk: short(cursor + 34), recordStart: cursor, recordEnd: next};
    members.push(member);
    if (!name.endsWith('/') && resolvePart('', name) === name) {
      if (entries.has(name)) throw badArchive();
      entries.set(name, member);
    }
    cursor = next;
  }
  return {entries, members, view, directory: long(end + 16), comment: data.subarray(end + 22)};
}

async function inflate(source, size) {
  let stream;
  try { stream = new DecompressionStream('deflate-raw'); }
  catch { throw new Error('Для просмотра файлов Office нужен браузер с поддержкой распаковки ZIP.'); }
  const reader = new Blob([source]).stream().pipeThrough(stream).getReader();
  const output = new Uint8Array(size);
  let cursor = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (cursor + value.length > size) {
        await reader.cancel();
        throw badArchive();
      }
      output.set(value, cursor);
      cursor += value.length;
    }
  } finally { reader.releaseLock(); }
  if (cursor !== size) throw badArchive();
  return output;
}

const crcTable = Uint32Array.from({length: 256}, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function crc32(data) {
  let checksum = 0xffffffff;
  for (const byte of data) checksum = (checksum >>> 8) ^ crcTable[(checksum ^ byte) & 255];
  return (checksum ^ 0xffffffff) >>> 0;
}

async function compress(data) {
  if (data.length < 128 || typeof CompressionStream !== 'function') return data;
  let stream;
  try { stream = new CompressionStream('deflate-raw'); }
  catch { return data; }
  const packed = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());
  return packed.length < data.length ? packed : data;
}

async function newRecords(parts) {
  if (parts.size > MAX_ENTRIES) throw badArchive();
  const records = new Map();
  let total = 0;
  for (const [path, contents] of parts) {
    if (typeof path !== 'string' || !path || /[\x00-\x1f]/.test(path) || resolvePart('', path) !== path) throw badArchive();
    const name = encoder.encode(path);
    if (name.length > 65535) throw badArchive();
    const data = typeof contents === 'string' ? encoder.encode(contents) : contents;
    if (!(data instanceof Uint8Array)) throw new TypeError('Часть Office должна быть текстом или массивом байтов.');
    total += data.length;
    if (data.length > MAX_MEMBER || total > MAX_OUTPUT) throw new Error('Слишком большой документ для сохранения.');
    const checksum = crc32(data);
    const packed = await compress(data);
    const header = new Uint8Array(30 + name.length);
    const local = new DataView(header.buffer);
    local.setUint32(0, signature.local, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, packed === data ? 0 : 8, true);
    local.setUint16(12, 0x21, true); // DOS date: 1980-01-01.
    local.setUint32(14, checksum, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    header.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const directory = new DataView(central.buffer);
    directory.setUint32(0, signature.central, true);
    directory.setUint16(4, 20, true);
    central.set(header.subarray(4, 30), 6);
    central.set(name, 46);
    records.set(path, {local: [header, packed], central});
  }
  return records;
}

function assembleZip(records, comment = new Uint8Array()) {
  if (records.length > MAX_ENTRIES) throw badArchive();
  const localChunks = [];
  const directory = [];
  let localLength = 0, directoryLength = 0;
  for (const {local, central} of records) {
    new DataView(central.buffer, central.byteOffset, central.length).setUint32(42, localLength, true);
    for (const chunk of local) {
      localLength += chunk.length;
      localChunks.push(chunk);
    }
    directoryLength += central.length;
    directory.push(central);
  }
  if (localLength + directoryLength >= ZIP32_LIMIT) throw new Error('Слишком большой архив Office.');
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, signature.end, true);
  tail.setUint16(8, records.length, true);
  tail.setUint16(10, records.length, true);
  tail.setUint32(12, directoryLength, true);
  tail.setUint32(16, localLength, true);
  tail.setUint16(20, comment.length, true);
  const output = new Uint8Array(localLength + directoryLength + end.length + comment.length);
  let cursor = 0;
  for (const chunk of [...localChunks, ...directory, end, comment]) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

export async function writeOfficeZip(parts) {
  return assembleZip([...(await newRecords(parts)).values()]);
}

export class OfficePackage {
  constructor(data) {
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
    Object.assign(this, indexZip(this.data));
    this.cache = new Map();
    this.outputSize = 0;
  }

  read(path) {
    if (!this.cache.has(path)) this.cache.set(path, this.extract(path));
    return this.cache.get(path);
  }

  dataStart(member, limit = this.directory) {
    const {offset, packed} = member;
    if (offset + 30 > limit || this.view.getUint32(offset, true) !== signature.local) throw badArchive();
    const start = offset + 30 + this.view.getUint16(offset + 26, true) + this.view.getUint16(offset + 28, true);
    if (start + packed > limit) throw badArchive();
    return start;
  }

  async replaceParts(parts) {
    const replacements = await newRecords(parts);
    if (!replacements.size) return this.data.slice();
    const byOffset = [...this.members].sort((a, b) => a.offset - b.offset);
    const localEnds = new Map(byOffset.map((member, index) =>
      [member, Math.min(byOffset[index + 1]?.offset ?? this.directory, this.directory)]));
    const records = [];
    for (const member of this.members) {
      const {name, offset, packed, size, method, flags, disk, recordStart, recordEnd} = member;
      if (flags & ENCRYPTION) throw new Error('Зашифрованный архив Office недоступен для редактирования.');
      if (disk || offset === ZIP32_LIMIT || size === ZIP32_LIMIT || packed === ZIP32_LIMIT) throw badArchive();
      const end = localEnds.get(member);
      const start = this.dataStart(member, end);
      if (this.view.getUint16(offset + 6, true) !== flags || this.view.getUint16(offset + 8, true) !== method
        || ((flags & DATA_DESCRIPTOR) && start + packed + 12 > end)) throw badArchive();
      if (replacements.has(name)) {
        records.push(replacements.get(name));
        replacements.delete(name);
      } else {
        records.push({
          local: [this.data.subarray(offset, end)],
          central: this.data.slice(recordStart, recordEnd),
        });
      }
    }
    return assembleZip([...records, ...replacements.values()], this.comment);
  }

  async extract(path) {
    const entry = this.entries.get(path);
    if (!entry) return null;
    const {packed, size, method, flags} = entry;
    if (flags & 1) throw new Error('Предпросмотр зашифрованных документов Office недоступен.');
    if (size > MAX_MEMBER || this.outputSize + size > MAX_OUTPUT) throw new Error('Слишком большой документ для предпросмотра.');
    const start = this.dataStart(entry);
    this.outputSize += size;
    const source = this.data.subarray(start, start + packed);
    if (method === 0 && packed === size) return source;
    if (method === 8) return inflate(source, size);
    throw badArchive();
  }

  async xml(path) {
    const data = await this.read(path);
    if (!data) return null;
    const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le'
      : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8';
    const xml = new TextDecoder(encoding).decode(data);
    if (/<!DOCTYPE/i.test(xml)) throw new Error('Документ содержит неподдерживаемое определение XML.');
    const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
    if (!root || root.localName === 'parsererror' || descendants(root, 'parsererror').length) throw badArchive();
    return root;
  }

  async relationships(path) {
    const split = path.lastIndexOf('/') + 1;
    const root = await this.xml(`${path.slice(0, split)}_rels/${path.slice(split)}.rels`);
    const relations = new Map();
    for (const link of children(root, 'Relationship')) {
      if (link.getAttribute('TargetMode') === 'External') continue;
      const target = resolvePart(path, link.getAttribute('Target'));
      if (target) relations.set(link.getAttribute('Id'), {path: target, type: link.getAttribute('Type') ?? ''});
    }
    return relations;
  }

  async rootPart(fallback) {
    const root = await this.relationships('');
    return [...root.values()].find(part => part.type.endsWith('/officeDocument'))?.path ?? fallback;
  }
}
