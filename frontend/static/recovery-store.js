import {emit,uid} from './core.js';
import {transaction} from './storage.js';

export const DRAFT_KEYS = {
  meta:'office-draft-meta:', data:'office-draft-data:', base:'office-draft-base:',
};
const kinds = new Set(['docx','xlsx','pptx']);
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('greenos-recovery') : null;
if (channel) channel.onmessage = () => emit('recovery');
function notify() { emit('recovery'); channel?.postMessage(true); }
const validMeta = meta => meta?.version === 1 && idPattern.test(meta.id) && kinds.has(meta.kind)
  && typeof meta.name === 'string' && meta.name.length <= 180
  && Number.isFinite(meta.updated) && Math.abs(meta.updated)<=8.64e15 && idPattern.test(meta.writer) && idPattern.test(meta.revision)
  && typeof meta.hasBase === 'boolean';

export async function listOfficeDrafts() {
  const prefix = DRAFT_KEYS.meta;
  const entries = await transaction('state','readonly',store=>store.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff')));
  return entries.filter(validMeta).sort((a,b)=>b.updated-a.updated);
}

export async function readOfficeDraft(id) {
  if (!idPattern.test(id)) return null;
  let meta,data,base;
  await transaction('state','readonly',store=>{
    meta=store.get(DRAFT_KEYS.meta+id);
    data=store.get(DRAFT_KEYS.data+id);
    base=store.get(DRAFT_KEYS.base+id);
  });
  if (!validMeta(meta.result) || meta.result.id!==id || !data.result || typeof data.result!=='object') return null;
  if (meta.result.hasBase && (!(base.result?.data instanceof Uint8Array) || base.result.data.byteLength>32*1024*1024)) return null;
  if (meta.result.kind!=='docx' && !meta.result.hasBase) return null;
  return {meta:meta.result,data:data.result,base:base.result};
}

async function updateDraft(id,update) {
  let changed=false, failure;
  await transaction('state','readwrite',store=>{
    const key=DRAFT_KEYS.meta+id;
    const request=store.get(key);
    request.onsuccess=()=>{
      try { changed=update(store,key,request.result); }
      catch(error) { failure=error; store.transaction.abort(); }
    };
  }).catch(error=>{ throw failure??error; });
  if (changed) notify();
  return changed;
}

export function removeOfficeDraft(meta) {
  if (!validMeta(meta)) return Promise.resolve(false);
  return updateDraft(meta.id,(store,key,current)=>{
    if (current?.revision!==meta.revision) return false;
    store.delete(key);
    store.delete(DRAFT_KEYS.data+meta.id);
    store.delete(DRAFT_KEYS.base+meta.id);
    return true;
  });
}

function claimOfficeDraft(meta,writer) {
  return updateDraft(meta.id,(store,key,current)=>{
    if (current?.revision!==meta.revision) return false;
    store.put({...current,writer,revision:uid()},key);
    return true;
  });
}

function writeOfficeDraft(meta,data,base) {
  return updateDraft(meta.id,(store,key,current)=>{
    if (current && current.writer!==meta.writer) return false;
    store.put(meta,key);
    store.put(data,DRAFT_KEYS.data+meta.id);
    if (!current && meta.hasBase) store.put(base,DRAFT_KEYS.base+meta.id);
    return true;
  });
}

function clearOwnedDraft(id,writer) {
  return updateDraft(id,(store,key,current)=>{
    if (current?.writer!==writer) return false;
    store.delete(key);
    store.delete(DRAFT_KEYS.data+id);
    store.delete(DRAFT_KEYS.base+id);
    return true;
  });
}

export function officeDraftRecorder({kind,base,restored,capture,name,onStatus}) {
  const writer=uid();
  let id=restored?.meta.id??uid();
  let timer=0, generation=0, durable=restored?0:-1, pending;
  let needsClear=Boolean(restored), stopped=false;
  let tail=Promise.resolve();
  const status=(state,message='')=>{ if (!stopped) onStatus(state,message); };

  function queue(action) {
    const operation=tail.then(action);
    tail=operation.catch(()=>{});
    return operation;
  }

  function flush() {
    clearTimeout(timer);
    timer=0;
    if (stopped) return Promise.resolve();
    if (pending?.stamp===generation) return pending.promise;
    if (durable===generation) return tail;
    const stamp=generation;
    let data,filename;
    try { data=capture(); filename=String(name()).slice(0,180); }
    catch(error) { status('error',error.message); return Promise.reject(error); }
    status('pending');
    needsClear=true;
    const operation=queue(async()=>{
      const meta={version:1,id,kind,name:filename,updated:Date.now(),writer,revision:uid(),hasBase:Boolean(base)};
      if (!await writeOfficeDraft(meta,data,base)) {
        id=uid();
        meta.id=id;
        if (!await writeOfficeDraft(meta,data,base)) throw new Error('Не удалось выделить место для черновика.');
      }
      durable=stamp;
      if (generation===stamp) status('saved');
    });
    const promise=operation.catch(error=>{
      if (generation===stamp) status('error',error.message);
      throw error;
    }).finally(()=>{
      if (pending?.stamp===stamp) pending=null;
    });
    pending={stamp,promise};
    return promise;
  }

  function change() {
    if (stopped) return;
    generation++;
    needsClear=true;
    status('pending');
    if (!timer) timer=setTimeout(()=>{ void flush().catch(()=>{}); },500);
  }

  function clear() {
    clearTimeout(timer);
    timer=0;
    if (!needsClear) return tail;
    needsClear=false;
    const stamp=++generation;
    return queue(async()=>{
      await clearOwnedDraft(id,writer);
      durable=-1;
      if (generation===stamp) status('idle');
    }).catch(error=>{
      if (generation===stamp) {
        needsClear=true;
        status('error',error.message);
      }
    });
  }

  if (restored) {
    status('saved');
    void queue(async()=>{
      if (!await claimOfficeDraft(restored.meta,writer)) {
        id=uid();
        durable=-1;
        if (needsClear) change();
      }
    }).catch(error=>{ durable=-1; status('error',error.message); });
  }

  return {get id(){return id;},change,flush,clear,stop(){
    stopped=true;
    clearTimeout(timer);
    timer=0;
  }};
}
