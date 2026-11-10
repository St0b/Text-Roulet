import {uid, emit, GREENOS_VERSION} from './core.js';

let database;
const namesIndex = 'parent-name';
export async function openDatabase() {
  if (database) return database;
  database = await new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('greenos-v2', 2);
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) {
        request.result.createObjectStore('files', {keyPath:'id'});
        request.result.createObjectStore('state');
      }
      request.transaction.objectStore('files').createIndex(namesIndex,['parent','name']);
    };
    request.onsuccess = () => {
      const connection = request.result;
      if (blocked) { connection.close(); return; }
      connection.onversionchange = () => {
        connection.close();
        if (database === connection) database = null;
      };
      resolve(connection);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Закройте старые вкладки GreenOS и обновите страницу.'));
    };
  });
  return database;
}

export function transactionStores(names, mode, operation) {
  return new Promise((resolve, reject) => {
    if (!database) { reject(new Error('Обновите страницу, чтобы открыть хранилище GreenOS.')); return; }
    const tx = database.transaction(names,mode);
    const stores = Object.fromEntries(names.map(name=>[name,tx.objectStore(name)]));
    let request, abortedWith;
    const abort = error => { abortedWith=error; tx.abort(); };
    tx.oncomplete = () => resolve(request?.result);
    tx.onabort = () => reject(abortedWith || tx.error || new Error('Запись отменена.'));
    try { request=operation(stores,abort,tx); } catch(error) { abort(error); }
  });
}
export function transaction(store, mode, operation) {
  return transactionStores([store],mode,(stores,abort)=>operation(stores[store],abort));
}
export const state = {
  get: key => transaction('state', 'readonly', s => s.get(key)),
  set: (key, value) => transaction('state', 'readwrite', s => s.put(value, key)),
  delete: key => transaction('state', 'readwrite', s => s.delete(key)),
};

const protectedIds = new Set(['home', 'desktop', 'documents', 'downloads', 'pictures', 'shared']);
const fileEvents = typeof BroadcastChannel === 'function' ? new BroadcastChannel('greenos-files') : null;
const duplicateName = 'Объект с таким именем уже существует.';
function fileConflict(message) {
  const error = new Error(message);
  error.name = 'FileConflictError';
  return error;
}

function sameFileVersion(node, expected) {
  if (!node || node.id!==expected.id) return false;
  if (node.revision || expected.revision) return node.revision===expected.revision;
  // Files created before revisions were introduced retain their original metadata.
  return node.modified===expected.modified && node.parent===expected.parent && node.name===expected.name
    && node.trashRoot===expected.trashRoot && node.type===expected.type;
}

function checkParent(store,parent,excluded,done,abort) {
  const visited = new Set();
  const next = id => {
    if (id===excluded) { abort(fileConflict('Нельзя переместить папку внутрь себя.')); return; }
    if (visited.has(id)) { abort(fileConflict('Папка назначения не найдена.')); return; }
    visited.add(id);
    const request = store.get(id);
    request.onsuccess = () => {
      const node = request.result;
      if (node?.type!=='dir' || node.trashRoot) { abort(fileConflict('Папка назначения не найдена.')); return; }
      if (node.parent!==null) next(node.parent);
      else done();
    };
  };
  next(parent);
}

function checkName(store,node,done,abort) {
  const request = store.index(namesIndex).openCursor(IDBKeyRange.only([node.parent,node.name]));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) { done(); return; }
    if (cursor.primaryKey!==node.id && !cursor.value.trashRoot) { abort(fileConflict(duplicateName)); return; }
    cursor.continue();
  };
}

export class FileSystem {
  nodes = [];
  async init() {
    this.nodes = await transaction('files', 'readonly', s => s.getAll());
    if (!this.nodes.length) {
      const now = Date.now();
      const folder = (id, name, parent) => ({id,name,parent,type:'dir',modified:now});
      const initial = [folder('home','green',null),folder('desktop','Рабочий стол','home'),folder('documents','Документы','home'),folder('downloads','Загрузки','home'),folder('pictures','Изображения','home'),folder('shared','Обмен с Linux','home'),
        {id:uid(),name:'Начните здесь.txt',parent:'documents',type:'file',mime:'text/plain',modified:now,data:new TextEncoder().encode('Добро пожаловать в GreenOS '+GREENOS_VERSION+'!\n\nLinux — настоящая виртуальная машина x86, исполняемая через WebAssembly.\nBuildroot: быстрая консоль Linux 6.8 с BusyBox, vi и Lua.\nTiny Core: графический дистрибутив с рабочим столом и приложениями.\nМожно загрузить собственный 32-битный ISO. 64-битные системы не поддерживаются.\n\nФайлы рабочего стола хранятся в IndexedDB этого браузера.\nФайлы из папки «Обмен с Linux» копируются в /mnt при запуске Buildroot.\nДля передачи изменений нажмите «Отправить в Linux» в меню файла.\nПосле изменений в Linux нажмите «Из Linux» в файловом менеджере.\n\nСнимок виртуальной машины сохраняет RAM и состояние устройств.\nСохраняйте снимок перед перезагрузкой страницы; его можно скачать.\nФайлы гостевой Linux и файлы рабочего стола — разные хранилища.\n\nГорячие клавиши:\nAlt+F1 — меню\nAlt+Tab — сменить окно\nAlt+F4 — закрыть окно\nCtrl+Alt+1 / 2 / 3 — рабочее пространство\nCtrl+S — сохранить текст\n\nИнтернет гостевой Linux: HTTP через браузер, с ограничениями CORS.\nДля полноценной сети настройте собственный WebSocket relay в Linux-приложении.\n')}];
      // Carry over the old GreenOS scratchpad without discarding its original value.
      const legacy = localStorage.getItem('greenos-notes');
      if (legacy) initial.push({id:uid(),name:'Мои старые заметки.txt',parent:'documents',type:'file',mime:'text/plain',modified:now,data:new TextEncoder().encode(legacy)});
      await transaction('files','readwrite',store=>{
        const count=store.count();
        count.onsuccess=()=>{ if (!count.result) for (const node of initial) store.put(node); };
      });
      this.nodes=await transaction('files','readonly',store=>store.getAll());
    }
  }
  get(id) { return this.nodes.find(n => n.id === id); }
  list(parent, trash = false) { return this.nodes.filter(n => trash ? n.trashRoot : n.parent === parent && !this.isTrashed(n)).sort((a,b) => (b.type==='dir')-(a.type==='dir') || a.name.localeCompare(b.name,'ru')); }
  isTrashed(node) { const seen = new Set(); while (node) { if (node.trashRoot) return true; if(seen.has(node.id)) return true; seen.add(node.id); node = this.get(node.parent); } return false; }
  path(id) { const list=[]; let n=this.get(id); while(n) {list.unshift(n);n=this.get(n.parent);} return list; }
  validateName(name) { if (!name || name.length>180 || /[\x00-\x1f/\\]/.test(name) || ['.','..'].includes(name)) throw new Error('Укажите имя до 180 символов без / и \\.'); }
  unique(parent,name,except) { if(this.nodes.some(n=>n.parent===parent && n.name===name && n.id!==except && !n.trashRoot)) throw new Error('Объект с таким именем уже существует.'); }
  async refresh({broadcast=false}={}) {
    this.nodes=await transaction('files','readonly',store=>store.getAll());
    emit('files');
    if (broadcast) fileEvents?.postMessage('refresh');
  }
  async refreshFiles(ids) {
    let requests;
    await transaction('files','readonly',store=>{ requests=ids.map(id=>store.get(id)); });
    ids.forEach((id,index)=>this.updateCache(id,requests[index].result));
    emit('files');
  }
  updateCache(id,node) {
    const index=this.nodes.findIndex(item=>item.id===id);
    if (index<0) { if (node) this.nodes.push(node); }
    else if (node) this.nodes[index]=node;
    else this.nodes.splice(index,1);
  }
  async commit(node,{expected,checkTarget=false}={}) {
    const updated={...node,revision:uid()};
    await transactionStores(['files'],'readwrite',({files},abort)=>{
      const write=()=>{
        try { files.put(updated); } catch(error) { abort(error); }
      };
      const validate=()=>{
        if (checkTarget) checkParent(files,node.parent,node.id,()=>checkName(files,node,write,abort),abort);
        else write();
      };
      if (expected===undefined) { validate(); return; }
      const current=files.get(node.id);
      current.onsuccess=()=>{
        const matches=expected===null ? !current.result : sameFileVersion(current.result,expected);
        if (!matches || checkTarget && current.result?.trashRoot && !expected?.trashRoot) {
          abort(fileConflict('Файл изменён, перемещён или удалён в другой вкладке. Сохраните новую копию.'));
          return;
        }
        validate();
      };
    });
    this.updateCache(updated.id,updated);
    emit('files',updated);
    fileEvents?.postMessage([updated.id]);
    return updated;
  }
  async mkdir(parent,name) {
    this.validateName(name);
    return this.commit({id:uid(),parent,name,type:'dir',modified:Date.now()},{expected:null,checkTarget:true});
  }
  async write(parent,name,data,mime='text/plain',id,{expected}={}) {
    this.validateName(name);
    if(!(data instanceof Uint8Array))data=new Uint8Array(data);
    if(data.byteLength>32*1024*1024)throw new Error('Лимит одного файла рабочего стола: 32 МБ. ISO загружайте через Linux.');
    return this.commit({id:id||uid(),parent,name,type:'file',mime,data,modified:Date.now()},
      {expected:id ? expected : null,checkTarget:true});
  }
  async rename(id,name) {this.validateName(name);const n=this.get(id);if(protectedIds.has(id))throw new Error('Системную папку нельзя переименовать.');this.unique(n.parent,name,id);return this.commit({...n,name,modified:Date.now()},{expected:n,checkTarget:!this.isTrashed(n)});}
  canMove(id) {
    const node = this.get(id);
    return !!node && !protectedIds.has(id) && !this.isTrashed(node);
  }
  async move(id,parent) {
    if (!this.canMove(id)) throw new Error('Этот объект нельзя переместить.');
    const n=this.get(id);
    const target=this.get(parent);if(!target||target.type!=='dir'||this.isTrashed(target))throw new Error('Папка назначения не найдена.');
    if(this.path(parent).some(p=>p.id===id))throw new Error('Нельзя переместить папку внутрь себя.');
    if (n.parent === parent) return n;
    this.unique(parent,n.name,id);return this.commit({...n,parent,modified:Date.now()},{expected:n,checkTarget:true});
  }
  async trash(id) {if(protectedIds.has(id))throw new Error('Системную папку нельзя удалить.');const n=this.get(id);if(!n)throw new Error('Объект не найден.');return this.commit({...n,trashRoot:true,modified:Date.now()},{expected:n});}
  async restore(id) {const n=this.get(id);this.unique(n.parent,n.name,id);return this.commit({...n,trashRoot:false},{expected:n,checkTarget:true});}
  async remove(id) {
    const ids=new Set();
    await transaction('files','readwrite',(store,abort)=>{
      const index=store.index(namesIndex);
      function removeTree(key) {
        if (ids.has(key)) return true;
        if (protectedIds.has(key)) { abort(new Error('Нельзя удалить системную папку.')); return false; }
        ids.add(key);
        store.delete(key);
        // The compound range selects every string name under this exact parent.
        const children=index.openKeyCursor(IDBKeyRange.bound([key],[key,[]]));
        children.onsuccess=()=>{
          const child=children.result;
          if (child && removeTree(child.primaryKey)) child.continue();
        };
        return true;
      }
      removeTree(id);
    });
    this.nodes=this.nodes.filter(n=>!ids.has(n.id));
    emit('files');
    fileEvents?.postMessage([...ids]);
  }
  async import(file,parent) {return this.write(parent,file.name,new Uint8Array(await file.arrayBuffer()),file.type||'application/octet-stream');}
}
export const fs = new FileSystem();
if (fileEvents) fileEvents.onmessage = ({data})=>{
  if (!database) return;
  const refresh=data==='refresh' ? fs.refresh() : Array.isArray(data) && data.every(id=>typeof id==='string') ? fs.refreshFiles(data) : null;
  refresh?.catch(error=>console.warn('File update failed',error));
};
