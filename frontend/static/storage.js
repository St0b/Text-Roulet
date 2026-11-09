import {uid, emit} from './core.js';

let database;
export async function openDatabase() {
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('greenos-v2', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('files', {keyPath:'id'});
      request.result.createObjectStore('state');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Закройте старые вкладки GreenOS и обновите страницу.'));
  });
  return database;
}
export function transaction(store, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode), object = tx.objectStore(store);
    let request;
    try { request = operation(object); } catch (e) { tx.abort(); reject(e); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error || new Error('Не удалось записать данные. Проверьте свободное место.'));
    tx.onabort = () => reject(tx.error || new Error('Запись отменена.'));
  });
}
export const state = {
  get: key => transaction('state', 'readonly', s => s.get(key)),
  set: (key, value) => transaction('state', 'readwrite', s => s.put(value, key)),
  delete: key => transaction('state', 'readwrite', s => s.delete(key)),
};

const protectedIds = new Set(['home', 'desktop', 'documents', 'downloads', 'pictures', 'shared']);
export class FileSystem {
  nodes = [];
  async init() {
    this.nodes = await transaction('files', 'readonly', s => s.getAll());
    if (!this.nodes.length) {
      const now = Date.now();
      const folder = (id, name, parent) => ({id,name,parent,type:'dir',modified:now});
      this.nodes = [folder('home','green',null),folder('desktop','Рабочий стол','home'),folder('documents','Документы','home'),folder('downloads','Загрузки','home'),folder('pictures','Изображения','home'),folder('shared','Обмен с Linux','home'),
        {id:uid(),name:'Начните здесь.txt',parent:'documents',type:'file',mime:'text/plain',modified:now,data:new TextEncoder().encode('Добро пожаловать в GreenOS 2.0!\n\nLinux — настоящая виртуальная машина x86, исполняемая через WebAssembly.\nBuildroot: быстрая консоль Linux 6.8 с BusyBox, vi и Lua.\nTiny Core: графический дистрибутив с рабочим столом и приложениями.\nМожно загрузить собственный 32-битный ISO. 64-битные системы не поддерживаются.\n\nФайлы рабочего стола хранятся в IndexedDB этого браузера.\nФайлы из папки «Обмен с Linux» копируются в /mnt при запуске Buildroot.\nДля передачи изменений нажмите «Отправить в Linux» в меню файла.\nПосле изменений в Linux нажмите «Из Linux» в файловом менеджере.\n\nСнимок виртуальной машины сохраняет RAM и состояние устройств.\nСохраняйте снимок перед перезагрузкой страницы; его можно скачать.\nФайлы гостевой Linux и файлы рабочего стола — разные хранилища.\n\nГорячие клавиши:\nAlt+F1 — меню\nAlt+Tab — сменить окно\nAlt+F4 — закрыть окно\nCtrl+Alt+1 / 2 / 3 — рабочее пространство\nCtrl+S — сохранить текст\n\nИнтернет гостевой Linux: HTTP через браузер, с ограничениями CORS.\nДля полноценной сети настройте собственный WebSocket relay в Linux-приложении.\n')}];
      await transaction('files', 'readwrite', s => { for (const n of this.nodes) s.put(n); });
      // Carry over the old GreenOS scratchpad without discarding its original value.
      const legacy = localStorage.getItem('greenos-notes');
      if (legacy) await this.write('documents', 'Мои старые заметки.txt', new TextEncoder().encode(legacy));
    }
  }
  get(id) { return this.nodes.find(n => n.id === id); }
  list(parent, trash = false) { return this.nodes.filter(n => trash ? n.trashRoot : n.parent === parent && !this.isTrashed(n)).sort((a,b) => (b.type==='dir')-(a.type==='dir') || a.name.localeCompare(b.name,'ru')); }
  isTrashed(node) { const seen = new Set(); while (node) { if (node.trashRoot) return true; if(seen.has(node.id)) return true; seen.add(node.id); node = this.get(node.parent); } return false; }
  path(id) { const list=[]; let n=this.get(id); while(n) {list.unshift(n);n=this.get(n.parent);} return list; }
  validateName(name) { if (!name || name.length>180 || /[\x00-\x1f/\\]/.test(name) || ['.','..'].includes(name)) throw new Error('Укажите имя до 180 символов без / и \\.'); }
  unique(parent,name,except) { if(this.nodes.some(n=>n.parent===parent && n.name===name && n.id!==except && !n.trashRoot)) throw new Error('Объект с таким именем уже существует.'); }
  async commit(node) {
    await transaction('files','readwrite',s=>s.put(node));
    const i=this.nodes.findIndex(n=>n.id===node.id); if(i<0)this.nodes.push(node);else this.nodes[i]=node;
    emit('files', node); return node;
  }
  async mkdir(parent,name) { this.validateName(name);this.unique(parent,name);if(this.get(parent)?.type!=='dir')throw new Error('Папка не найдена.');return this.commit({id:uid(),parent,name,type:'dir',modified:Date.now()}); }
  async write(parent,name,data,mime='text/plain',id) {
    this.validateName(name);this.unique(parent,name,id);
    if(this.get(parent)?.type!=='dir')throw new Error('Папка не найдена.');
    if(!(data instanceof Uint8Array))data=new Uint8Array(data);
    if(data.byteLength>32*1024*1024)throw new Error('Лимит одного файла рабочего стола: 32 МБ. ISO загружайте через Linux.');
    return this.commit({id:id||uid(),parent,name,type:'file',mime,data,modified:Date.now()});
  }
  async rename(id,name) {this.validateName(name);const n=this.get(id);if(protectedIds.has(id))throw new Error('Системную папку нельзя переименовать.');this.unique(n.parent,name,id);return this.commit({...n,name,modified:Date.now()});}
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
    this.unique(parent,n.name,id);return this.commit({...n,parent,modified:Date.now()});
  }
  async trash(id) {if(protectedIds.has(id))throw new Error('Системную папку нельзя удалить.');return this.commit({...this.get(id),trashRoot:true,modified:Date.now()});}
  async restore(id) {const n=this.get(id);this.unique(n.parent,n.name,id);return this.commit({...n,trashRoot:false});}
  async remove(id) {
    const ids=new Set([id]);let count;do{count=ids.size;for(const n of this.nodes)if(ids.has(n.parent))ids.add(n.id);}while(count!==ids.size);
    if([...ids].some(x=>protectedIds.has(x)))throw new Error('Нельзя удалить системную папку.');
    await transaction('files','readwrite',s=>{for(const key of ids)s.delete(key);});this.nodes=this.nodes.filter(n=>!ids.has(n.id));emit('files');
  }
  async import(file,parent) {return this.write(parent,file.name,new Uint8Array(await file.arrayBuffer()),file.type||'application/octet-stream');}
}
export const fs = new FileSystem();
