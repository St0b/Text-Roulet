import {$, $$, el, icon, settings, on, emit, ask, pickFile, download, bytes, escapeHTML} from './core.js';
import {fs, state, transaction} from './storage.js';
import {wm} from './windows.js';
import {linux, sendToLinux, receiveFromLinux} from './linux.js';
import {hasAvatar, removeAvatar, renderAvatar, updateAvatar} from './profile.js';
import {documentFormat} from './documents.js';

export const guard = callback => async(...args)=>{try{return await callback(...args);}catch(e){console.error(e);emit('toast',{message:e.message||'Операция не выполнена',error:true});}};
const notify=message=>emit('toast',{message});
export function openFile(node) {
  if(!node){notify('Файл не найден.');return;}
  if(node.type==='dir')return wm.open('files',{folder:node.id});
  if(documentFormat(node))return wm.open('office',{id:node.id});
  if(/^(image|audio|video)\//.test(node.mime))return wm.open('viewer',{id:node.id});
  if(node.data.byteLength>2*1024*1024||!isTextFile(node)){download(node.name,node.data,node.mime);return;}
  return wm.open('editor',{id:node.id});
}

function isTextFile(node) {
  if (/\.(doc|ppt|xls|rtf|odt|ods|odp|zip|gz|wasm|exe|bin|iso)$/i.test(node.name)) return false;
  try {
    const decoded = new TextDecoder('utf-8',{fatal:true}).decode(node.data);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(decoded);
  } catch { return false; }
}
export const welcomeApp={id:'welcome',name:'Добро пожаловать',subtitle:'Знакомство с GreenOS',icon:'leaf',singleton:true,width:840,height:555,
  mount(win){
    win.body.innerHTML=`<div class="welcome-layout"><aside class="welcome-side"><img src="/assets/leaf.svg" class="welcome-logo" alt=""><h2>green<span>os</span></h2><small>LINUX EDITION / 2.0</small><div style="height:35px"></div><div class="welcome-step active"><span>01</span>Добро пожаловать</div><div class="welcome-step"><span>02</span>Ваша Linux</div><div class="welcome-step"><span>03</span>Ваше пространство</div><footer>Создана для исследования.<br>Работает в вашем браузере.</footer></aside><main class="welcome-main"><div class="eyebrow">ПРИВЕТ. ВЫ ДОМА.</div><h1>Ваш рабочий стол.<br>Теперь <span>с Linux.</span></h1><p>Привычная среда, свободная от границ. Запускайте настоящий Linux, работайте с файлами и создавайте своё — в одной вкладке.</p><div class="welcome-actions"><button class="primary start-linux">${icon('linux')}Запустить Linux ${icon('arrow')}</button><button class="start-tinycore">Графический Linux</button></div><div class="welcome-cards"><article class="welcome-card">${icon('linux')}<h3>Настоящее ядро Linux</h3><p>Buildroot и Tiny Core на x86.<br>Команды, процессы, программы.</p></article><article class="welcome-card">${icon('files')}<h3>Файлы остаются с вами</h3><p>Локальное хранилище и обмен<br>файлами с виртуальной машиной.</p></article></div><div class="welcome-foot"><label><input class="show-welcome" type="checkbox" ${settings.get('welcome')?'checked':''}>Показывать при запуске</label><button class="text-button open-guide">Краткое руководство ↗</button></div></main></div>`;
    $('.start-linux',win.body).onclick=()=>wm.open('linux',{autostart:true});
    $('.start-tinycore',win.body).onclick=()=>wm.open('linux',{profile:'tinycore',autostart:true});
    $('.show-welcome',win.body).onchange=e=>settings.set({welcome:e.target.checked});
    $('.open-guide',win.body).onclick=()=>openFile(fs.list('documents').find(n=>n.name==='Начните здесь.txt')||fs.list('documents')[0]);
  }
};

const fileDragType = 'application/x-greenos-file';
let fileToMove = null;
const fileDate = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', year: 'numeric'});
const filePlaces = [
  ['home', 'home', 'Домашняя папка'], ['desktop', 'desktop', 'Рабочий стол'],
  ['documents', 'editor', 'Документы'], ['downloads', 'download', 'Загрузки'],
  ['pictures', 'image', 'Изображения'], ['shared', 'linux', 'Обмен с Linux'], ['trash', 'trash', 'Корзина'],
];

function setFileToMove(id) {
  fileToMove = id;
  emit('file-clipboard');
}

export const filesApp = {
  id: 'files', name: 'Файлы', subtitle: 'Папки и обмен с Linux', icon: 'files', width: 855, height: 555,

  mount(win, options = {}) {
    let folder = options.folder || 'home';
    let view = options.view === 'list' ? 'list' : 'grid';
    let selected = null;
    let filter = '';
    let dropTarget = null;
    const history = [];
    win.body.classList.add('files-window');
    win.body.innerHTML = `
      <div class="toolbar file-navigation">
        <button class="go-back icon-button" title="Назад" aria-label="Назад">${icon('back')}</button>
        <button class="go-up icon-button" title="На уровень выше" aria-label="На уровень выше">${icon('up')}</button>
        <div class="file-address" aria-label="Путь к папке"></div>
        <input class="file-search" type="search" placeholder="Поиск…" aria-label="Поиск файлов">
      </div>
      <div class="app-layout">
        <aside class="sidebar file-sidebar"><div class="sidebar-label">МЕСТА</div>
          ${filePlaces.map(([id, glyph, title]) => `<button data-folder="${id}" title="${title}" aria-label="${title}">${icon(glyph)}<span>${title}</span></button>`).join('')}
        </aside>
        <main class="app-main file-main">
          <header class="file-location">
            <span class="file-location-icon"></span>
            <div class="grow"><small>ХРАНИЛИЩЕ GREENOS</small><h2 class="file-location-name"></h2></div>
            <div class="file-window-tools">
              <button class="new-file-window icon-button" aria-label="Новое окно" title="Новое окно">${icon('plus')}</button>
              <button class="tile-file-windows" title="Поставить два окна рядом" aria-label="Поставить два окна рядом">${icon('split')}<span>Рядом</span></button>
            </div>
          </header>
          <div class="file-operations">
            <button class="new-folder" aria-label="Новая папка" title="Новая папка">${icon('plus')}<span>Папка</span></button>
            <button class="new-file" aria-label="Новый файл" title="Новый файл">${icon('editor')}<span>Файл</span></button>
            <button class="import-files" aria-label="Загрузить файлы" title="Загрузить файлы">${icon('upload')}<span>Загрузить</span></button>
            <button class="linux-pull" aria-label="Забрать файл из Linux" title="Забрать файл из Linux">${icon('download')}<span>Из Linux</span></button>
            <button class="paste-file" aria-label="Вставить" title="Вставить" disabled>${icon('clipboard')}<span>Вставить</span></button>
            <button class="selected-action" aria-label="Действия с объектом" title="Действия с объектом" disabled>⋯</button>
            <div class="file-view-switch" role="group" aria-label="Вид папки">
              <button data-view="grid" title="Плитки" aria-label="Плитки">${icon('grid')}</button>
              <button data-view="list" title="Список" aria-label="Список">${icon('list')}</button>
            </div>
          </div>
          <div class="file-list-head" aria-hidden="true" hidden><span>Имя</span><span>Размер</span><span>Изменён</span></div>
          <div class="file-grid" tabindex="0" aria-label="Содержимое папки"></div>
        </main>
      </div>
      <div class="statusbar"><span class="file-count"></span><span class="spacer"></span><span class="file-hint"></span></div>`;

    const q = selector => $(selector, win.body);
    const grid = q('.file-grid');

    function enter(id, recordHistory = true) {
      if (recordHistory && id === folder) return;
      if (recordHistory) history.push(folder);
      folder = id;
      selected = null;
      filter = '';
      q('.file-search').value = '';
      render();
      wm.changed();
    }

    function openEntry(node) {
      if (node?.type === 'dir') enter(node.id);
      else return openFile(node);
    }

    function openNewWindow(directory = folder) {
      return wm.open('files', {folder: directory, view});
    }

    function updateClipboard() {
      const node = fs.canMove(fileToMove) ? fs.get(fileToMove) : null;
      q('.paste-file').disabled = !node || folder === 'trash' || node.parent === folder;
      q('.file-hint').textContent = node ? `Вырезан «${node.name}»` : 'Локальное хранилище';
      for (const card of $$('.file-card', grid)) {
        card.classList.toggle('cut', card.dataset.fileId === node?.id);
      }
    }

    function selectCard(id) {
      selected = id;
      const cards = $$('.file-card', grid);
      for (const card of cards) {
        const active = card.dataset.fileId === selected;
        card.classList.toggle('selected', active);
        card.setAttribute('aria-pressed', String(active));
      }
      const node = fs.get(selected);
      q('.file-count').textContent = `Объектов: ${cards.length}${node ? ` · ${node.name}` : ''}`;
      q('.selected-action').disabled = !node;
    }

    async function moveEntry(id, destination) {
      if (fs.get(id)?.parent === destination) return;
      const node = await fs.move(id, destination);
      if (fileToMove === id) setFileToMove(null);
      notify(`«${node.name}» перемещён в папку «${fs.get(destination).name}».`);
    }

    function actions(node) {
      if (folder === 'trash') return [
        {label: 'Восстановить', action: guard(() => fs.restore(node.id))},
        {label: 'Удалить навсегда', danger: true, action: guard(async () => {
          if (await ask('Удалить навсегда?', {message: node.name, confirm: true, ok: 'Удалить'})) await fs.remove(node.id);
        })},
      ];
      const items = [{label: 'Открыть', action: () => openEntry(node)},
        {label: 'Создать ярлык на рабочем столе', action: () => emit('shortcut:add', {kind: 'file', id: node.id})}];
      if (node.type === 'dir') {
        items.push({label: 'Открыть в новом окне', action: () => openNewWindow(node.id)});
      } else {
        items.push({label: 'Скачать', action: () => download(node.name, node.data, node.mime)},
          {label: 'Отправить в Linux /mnt', action: guard(() => sendToLinux(node))});
      }
      if (fs.canMove(node.id)) items.push({label: 'Вырезать', action: () => setFileToMove(node.id)});
      items.push({label: 'Переименовать', action: guard(async () => {
        const name = await ask('Переименовать', {value: node.name});
        if (name) await fs.rename(node.id, name);
      })}, {label: 'В корзину', danger: true, action: guard(() => fs.trash(node.id))});
      return items;
    }

    function makeCard(node) {
      const directory = node.type === 'dir';
      const card = el('button', {class: `file-card ${node.type}`, draggable: String(folder !== 'trash' && fs.canMove(node.id)),
        title: node.name, 'aria-label': node.name, 'data-file-id': node.id});
      const fileIcon = directory ? 'files' : node.mime?.startsWith('image/') ? 'image' : 'editor';
      card.innerHTML = `<span class="file-type-icon">${icon(fileIcon)}</span>`;
      card.append(el('strong', {}, node.name), el('small', {class: 'file-size'}, directory ? 'Папка' : bytes(node.data.byteLength)),
        el('small', {class: 'file-modified'}, Number.isFinite(node.modified) ? fileDate.format(node.modified) : '—'));
      card.onclick = () => selectCard(node.id);
      card.ondblclick = () => { if (folder !== 'trash') openEntry(node); };
      card.oncontextmenu = event => {
        event.preventDefault();
        selectCard(node.id);
        emit('context', {x: event.clientX, y: event.clientY, items: actions(node)});
      };
      card.ondragstart = event => {
        if (folder === 'trash' || !fs.canMove(node.id)) return;
        selectCard(node.id);
        event.dataTransfer.setData(fileDragType, node.id);
        event.dataTransfer.effectAllowed = 'move';
      };
      return card;
    }

    function render() {
      const current = fs.get(folder);
      if (folder !== 'trash' && (current?.type !== 'dir' || fs.isTrashed(current))) folder = 'home';
      const name = folder === 'trash' ? 'Корзина' : fs.get(folder).name;
      win.setTitle(`${name} — Файлы`);
      q('.file-location-name').textContent = name;
      q('.file-location-icon').innerHTML = icon(folder === 'trash' ? 'trash' : 'files');
      const breadcrumb = q('.file-address');
      breadcrumb.replaceChildren();
      const path = folder === 'trash' ? [{id: 'trash', name}] : fs.path(folder);
      for (const node of path) {
        if (breadcrumb.childElementCount) breadcrumb.append(el('span', {class: 'muted', 'aria-hidden': 'true'}, '›'));
        breadcrumb.append(el('button', {onclick: () => enter(node.id)}, node.id === 'home' ? 'Домашняя' : node.name));
      }
      $$('[data-folder]', win.body).forEach(button => button.classList.toggle('active', button.dataset.folder === folder));
      q('.go-back').disabled = !history.length;
      q('.go-up').disabled = folder === 'home' || folder === 'trash';
      for (const selector of ['.new-folder', '.new-file', '.import-files']) q(selector).disabled = folder === 'trash';
      grid.dataset.view = view;
      q('.file-list-head').hidden = view !== 'list';
      for (const button of $$('[data-view]', win.body)) button.setAttribute('aria-pressed', String(button.dataset.view === view));
      const entries = fs.list(folder, folder === 'trash').filter(node => node.name.toLowerCase().includes(filter));
      grid.replaceChildren(...entries.map(makeCard));
      if (!entries.length) {
        const title = filter ? 'Ничего не найдено' : folder === 'trash' ? 'Корзина пуста' : 'Папка пуста';
        const hint = filter ? 'Попробуйте другое имя.' : folder === 'trash' ? 'Удалённые файлы появятся здесь.'
          : folder === 'shared' ? 'Загрузите файл или заберите его из Linux /mnt.' : 'Перетащите сюда файлы или создайте новый.';
        const empty = el('div', {class: 'file-empty empty'}, el('h3', {}, title), el('p', {}, hint));
        empty.insertAdjacentHTML('afterbegin', icon(folder === 'trash' ? 'trash' : 'files'));
        grid.append(empty);
      }
      selectCard(entries.some(node => node.id === selected) ? selected : null);
      updateClipboard();
    }

    q('.go-back').onclick = () => enter(history.pop() || 'home', false);
    q('.go-up').onclick = () => enter(fs.get(folder)?.parent || 'home');
    $$('[data-folder]', win.body).forEach(button => button.onclick = () => enter(button.dataset.folder));
    $$('[data-view]', win.body).forEach(button => button.onclick = () => {
      view = button.dataset.view;
      render();
      wm.changed();
    });
    q('.file-search').oninput = event => { filter = event.target.value.toLowerCase(); render(); };
    q('.new-file-window').onclick = () => openNewWindow();
    q('.tile-file-windows').onclick = async () => {
      const peer = wm.windows.findLast(other => other !== win && other.app.id === 'files' && other.workspace === win.workspace)
        || await openNewWindow();
      wm.tilePair(win, peer);
    };
    q('.new-folder').onclick = guard(async () => {
      const name = await ask('Новая папка', {value: 'Новая папка', ok: 'Создать'});
      if (name) await fs.mkdir(folder, name);
    });
    q('.new-file').onclick = guard(async () => {
      const name = await ask('Новый файл', {value: 'Новый документ.txt', ok: 'Создать'});
      if (name) openFile(await fs.write(folder, name, new Uint8Array()));
    });
    q('.import-files').onclick = guard(async () => {
      const destination = folder;
      const files = await pickFile('', true);
      for (const file of files) await fs.import(file, destination);
      if (files.length) notify('Файлы загружены.');
    });
    q('.linux-pull').onclick = guard(async () => {
      const name = await ask('Забрать файл из Linux', {message: 'Путь в общей файловой системе 9p (Buildroot: /mnt).', value: '/mnt/hello.txt', ok: 'Забрать'});
      if (name) await receiveFromLinux(name);
    });
    const paste = guard(async () => {
      if (!fileToMove || q('.paste-file').disabled) return;
      const id = fileToMove;
      setFileToMove(null);
      try {
        await moveEntry(id, folder);
      } catch (error) {
        if (!fileToMove && fs.canMove(id)) setFileToMove(id);
        throw error;
      }
    });
    q('.paste-file').onclick = paste;
    q('.selected-action').onclick = event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const node = fs.get(selected);
      if (node) emit('context', {x: bounds.left, y: bounds.bottom + 4, items: actions(node)});
    };

    function clearDropPreview() {
      dropTarget?.classList.remove('drop-target');
      dropTarget = null;
      grid.classList.remove('file-drop');
    }

    grid.ondragover = event => {
      const types = event.dataTransfer.types;
      if (folder === 'trash' || !(types.includes(fileDragType) || types.includes('Files'))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = types.includes(fileDragType) ? 'move' : 'copy';
      const target = event.target.closest('.file-card.dir');
      if (target !== dropTarget) {
        dropTarget?.classList.remove('drop-target');
        dropTarget = target;
        dropTarget?.classList.add('drop-target');
      }
      grid.classList.toggle('file-drop', !target);
    };
    grid.ondragleave = event => { if (!grid.contains(event.relatedTarget)) clearDropPreview(); };
    grid.ondrop = guard(async event => {
      event.preventDefault();
      clearDropPreview();
      if (folder === 'trash') return;
      const destination = event.target.closest('.file-card.dir')?.dataset.fileId ?? folder;
      const id = event.dataTransfer.getData(fileDragType);
      if (id) await moveEntry(id, destination);
      else for (const file of event.dataTransfer.files) await fs.import(file, destination);
    });
    grid.onkeydown = guard(async event => {
      if (folder === 'trash') return;
      const id = event.target.closest('.file-card')?.dataset.fileId ?? selected;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        await paste();
      } else if (id && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && fs.canMove(id)) {
        event.preventDefault();
        setFileToMove(id);
      } else if (id && event.key === 'Enter') {
        event.preventDefault();
        await openEntry(fs.get(id));
      } else if (id && event.key === 'Delete') {
        event.preventDefault();
        await fs.trash(id);
      }
    });
    on('files', () => {
      if (fileToMove && !fs.canMove(fileToMove)) setFileToMove(null);
      render();
    }, win.abort.signal);
    on('file-clipboard', updateClipboard, win.abort.signal);
    win.serialize = () => ({folder, view});
    render();
  },
};

export const editorApp={id:'editor',name:'Текстовый редактор',subtitle:'Тексты и код',icon:'editor',width:760,height:555,
  async mount(win,options={}){
    let node=options.id?fs.get(options.id):null,dirty=false;
    win.body.innerHTML=`<div class="toolbar editor-toolbar"><input class="document-name" aria-label="Имя файла" placeholder="Новый документ.txt"><button class="save-document primary">${icon('save')}Сохранить</button><button class="download-document" title="Скачать текст" aria-label="Скачать текст">${icon('download')}</button></div><textarea class="editor-area" spellcheck="false" aria-label="Текст документа" placeholder="Начните писать…"></textarea><div class="statusbar"><span class="editor-state">Сохранено</span><span class="spacer"></span><span class="editor-position"></span><span>UTF-8</span></div>`;
    const q=s=>$(s,win.body),area=q('.editor-area'),name=q('.document-name');
    name.value=node?.name||options.name||'Новый документ.txt';area.value=options.draft??(node?new TextDecoder().decode(node.data):'');
    const update=()=>{win.setTitle(`${dirty?'● ':''}${name.value||'Без имени'} — Редактор`);q('.editor-state').textContent=dirty?'Не сохранено':'Сохранено';const start=area.value.slice(0,area.selectionStart),lines=start.split('\n');q('.editor-position').textContent=`Стр ${lines.length}, стл ${lines.at(-1).length+1} · ${area.value.length} символов`;};
    const save=guard(async()=>{
      const parent=node&&!fs.isTrashed(node)?node.parent:'documents';
      node=await fs.write(parent,name.value.trim()||'Новый документ.txt',new TextEncoder().encode(area.value),'text/plain',node&&!fs.isTrashed(node)?node.id:undefined);
      dirty=false;update();notify('Документ сохранён.');
    });
    win.save=save;
    area.oninput=()=>{dirty=true;update();};area.onclick=area.onkeyup=update;name.oninput=()=>{dirty=true;update();};
    area.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();const p=area.selectionStart;area.setRangeText('  ',p,area.selectionEnd,'end');dirty=true;update();}};
    q('.save-document').onclick=save;q('.download-document').onclick=()=>download(name.value||'document.txt',area.value,'text/plain;charset=utf-8');
    win.beforeClose=async()=>!dirty||!!await ask('Закрыть без сохранения?',{message:'Последние изменения документа будут потеряны.',confirm:true,ok:'Закрыть'});
    win.serialize=()=>({id:node?.id,name:name.value,...(dirty||!node?{draft:area.value}:{})});dirty=options.draft!=null;update();
  }
};
export const viewerApp={id:'viewer',name:'Просмотр файлов',subtitle:'Изображения и медиа',icon:'image',hidden:true,width:770,height:560,
  mount(win,{id}){const node=fs.get(id);if(!node)throw new Error('Файл не найден.');win.setTitle(node.name);const url=URL.createObjectURL(new Blob([node.data],{type:node.mime}));
    const holder=el('div',{class:'viewer'});let media;
    if(node.mime.startsWith('image/'))media=el('img',{src:url,alt:node.name});else media=el(node.mime.startsWith('audio/')?'audio':'video',{src:url,controls:true});holder.append(media);win.body.append(holder);
    return()=>{media.pause?.();URL.revokeObjectURL(url);};}
};

const bootTime=Date.now();
export const monitorApp={id:'monitor',name:'Системный монитор',subtitle:'Процессы и ресурсы',icon:'monitor',singleton:true,width:780,height:540,
  mount(win){
    win.body.innerHTML=`<div class="content-pad"><h2>Система под вашим контролем</h2><p style="font-size:11px">Ресурсы вкладки и виртуальной машины. Данные обновляются в реальном времени.</p><div class="metric-grid"><div class="metric">${icon('monitor')}<small> Время работы</small><strong class="uptime"></strong><small>Текущая сессия</small></div><div class="metric">${icon('linux')}<small> Linux RAM</small><strong class="ram"></strong><small class="vm-label"></small></div><div class="metric">${icon('files')}<small> Хранилище</small><strong class="disk"></strong><small class="quota"></small></div></div><h3 style="font-size:12px;font-weight:500">Приложения <span class="muted process-count"></span></h3><table class="process-table"><thead><tr><th>ПРИЛОЖЕНИЕ</th><th>PID</th><th>ПРОСТРАНСТВО</th><th></th></tr></thead><tbody></tbody></table><p class="heap muted" style="font-size:10px;margin-top:17px"></p></div>`;
    const q=s=>$(s,win.body);
    const render=async()=>{if(win.abort.signal.aborted)return;const sec=Math.floor((Date.now()-bootTime)/1000);q('.uptime').textContent=`${Math.floor(sec/3600).toString().padStart(2,'0')}:${Math.floor(sec/60%60).toString().padStart(2,'0')}:${(sec%60).toString().padStart(2,'0')}`;q('.ram').textContent=linux.vm?`${linux.ram} МБ`:'—';q('.vm-label').textContent=linux.status;
      q('tbody').replaceChildren();q('.process-count').textContent=`(${wm.windows.length})`;
      for(const w of wm.windows){const row=el('tr');const name=el('td');name.innerHTML=icon(w.app.icon);name.append(w.app.name);const button=el('button',{},'Закрыть');button.onclick=()=>wm.close(w);row.append(name,el('td',{class:'mono'},String(w.id)),el('td',{},String(w.workspace+1)),el('td',{},button));q('tbody').append(row);}
      q('.heap').textContent=performance.memory?`JS heap: ${bytes(performance.memory.usedJSHeapSize)} · Это память JavaScript, а не вся память браузера.`:'Браузер не предоставляет измерение JS heap.';
      try{const estimate=await navigator.storage.estimate();if(win.abort.signal.aborted)return;q('.disk').textContent=bytes(estimate.usage||0);q('.quota').textContent=`Лимит браузера: ${bytes(estimate.quota||0)}`;}catch{q('.disk').textContent=bytes(fs.nodes.reduce((a,n)=>a+(n.data?.byteLength||0),0));q('.quota').textContent='Объём файлов рабочего стола';}
    };render();const timer=setInterval(render,2000);on('windows',render,win.abort.signal);return()=>clearInterval(timer);
  }
};

async function exportFiles(){
  const nodes=fs.nodes.map(n=>{let data;if(n.data){let binary='';for(let i=0;i<n.data.length;i+=8192)binary+=String.fromCharCode(...n.data.subarray(i,i+8192));data=btoa(binary);}return {...n,data};});
  download('greenos-files.json',JSON.stringify({format:'greenos-files',version:2,nodes}),'application/json');
}
async function importFiles(file){
  if(file.size>100*1024*1024)throw new Error('Архив файлов слишком большой (максимум 100 МБ).');
  const parsed=JSON.parse(await file.text());
  if(parsed.format!=='greenos-files'||parsed.version!==2||!Array.isArray(parsed.nodes)||parsed.nodes.length>10000)throw new Error('Неподдерживаемый архив.');
  const seen=new Set();const nodes=parsed.nodes.map(n=>{
    if(typeof n.id!=='string'||seen.has(n.id)||!['dir','file'].includes(n.type)||typeof n.name!=='string'||!Number.isFinite(n.modified))throw new Error('Повреждён архив файлов.');
    fs.validateName(n.name);seen.add(n.id);
    const data=n.type==='file'?Uint8Array.from(atob(n.data),c=>c.charCodeAt(0)):undefined;
    if(data?.byteLength>32*1024*1024)throw new Error('Файл в архиве превышает 32 МБ.');
    return {id:n.id,name:n.name,parent:n.parent,type:n.type,modified:n.modified,mime:typeof n.mime==='string'?n.mime:'application/octet-stream',data,trashRoot:!!n.trashRoot};
  });
  const byId=new Map(nodes.map(n=>[n.id,n]));
  for(const id of ['home','desktop','documents','downloads','pictures','shared'])if(byId.get(id)?.type!=='dir')throw new Error('В архиве отсутствуют системные папки.');
  for(const n of nodes){const visited=new Set();let current=n;while(current){if(visited.has(current.id))throw new Error('Цикл папок в архиве.');visited.add(current.id);if(current.id==='home'){if(current.parent!==null)throw new Error('Повреждена домашняя папка.');break;}const parent=byId.get(current.parent);if(parent?.type!=='dir')throw new Error('Папка в архиве отсутствует.');current=parent;}}
  if(!await ask('Восстановить файлы из архива?',{message:'Текущие файлы рабочего стола будут заменены файлами из архива. Снимки Linux сохранятся.',confirm:true,ok:'Восстановить'}))return;
  await transaction('files','readwrite',s=>{s.clear();for(const n of nodes)s.put(n);});fs.nodes=nodes;emit('files');notify('Архив файлов восстановлен.');
}
export const settingsApp={id:'settings',name:'Настройки',subtitle:'Оформление и система',icon:'settings',singleton:true,width:820,height:570,
  mount(win,options){
    win.body.innerHTML=`<div class="app-layout"><aside class="sidebar"><div class="sidebar-label">GREENOS</div>${[['appearance','image','Оформление'],['user','home','Пользователь'],['data','files','Данные'],['about','info','О системе']].map(([id,i,t])=>`<button data-tab="${id}">${icon(i)}<span>${t}</span></button>`).join('')}</aside><main class="app-main settings-main"></main></div>`;
    const root=$('.settings-main',win.body);
    const tabs=['appearance','user','data','about'];
    let tab=tabs.includes(options.tab)?options.tab:'appearance';
    win.activate=({tab: next})=>{if(tabs.includes(next)){tab=next;render();}};
    function refreshProfileAvatar(){
      renderAvatar($('.profile-avatar',root));
      const button=$('.avatar-remove',root);
      if(button)button.hidden=!hasAvatar();
    }
    on('avatar',refreshProfileAvatar,win.abort.signal);
    function render(){
      $$('[data-tab]',win.body).forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
      if(tab==='appearance'){
        root.innerHTML=`<h2>Сделайте GreenOS своей</h2><p style="font-size:11px">Немного цвета. Немного вас.</p><h3>Обои рабочего стола</h3><div class="wallpaper-options">${[['hills','Зелёные холмы'],['midnight','Полночь'],['mist','Туман'],['grid','Сетка']].map(([id,n])=>`<button class="wallpaper-choice ${settings.get('wallpaper')===id?'active':''}" data-wallpaper="${id}"><div class="sample"></div><small>${n}</small></button>`).join('')}</div><div class="setting-line"><div><strong>Тема интерфейса</strong><small>Для всех окон рабочего стола</small></div><select class="theme-choice" aria-label="Тема"><option value="dark">Тёмная</option><option value="light">Светлая</option></select></div><div class="setting-line"><div><strong>Акцентный цвет</strong><small>Выделения и элементы управления</small></div><div class="accent-options">${['#a5d890','#8fcac5','#d8c38f','#bdabe4'].map(c=>`<button data-color="${c}" style="background:${c}" title="${c}" aria-label="Цвет ${c}" class="${settings.get('accent')===c?'active':''}"></button>`).join('')}</div></div><label class="setting-line"><div><strong>Анимации</strong><small>Плавное открытие окон</small></div><input class="animations-choice" type="checkbox" ${settings.get('animations')?'checked':''}></label>`;
        $$('.wallpaper-choice',root).forEach(b=>b.onclick=()=>{settings.set({wallpaper:b.dataset.wallpaper});render();});
        $('.theme-choice',root).value=settings.get('theme');$('.theme-choice',root).onchange=e=>settings.set({theme:e.target.value});
        $$('[data-color]',root).forEach(b=>b.onclick=()=>{settings.set({accent:b.dataset.color});render();});$('.animations-choice',root).onchange=e=>settings.set({animations:e.target.checked});
      }else if(tab==='user'){
        root.innerHTML=`<h2>Профиль GreenOS</h2><p>Аватар и имя показываются в локальной оболочке GreenOS.</p><div class="profile-card"><div class="avatar profile-avatar" aria-hidden="true"></div><div class="grow"><strong>Аватар</strong><small>PNG, JPEG или WebP · до 10 МБ</small><div class="profile-actions"><button type="button" class="avatar-pick">Выбрать изображение</button><button type="button" class="avatar-remove">Удалить аватар</button></div></div></div><form class="user-form"><label class="setting-line"><div><strong>Имя пользователя</strong><small>Отображается в меню GreenOS</small></div><input class="user-name" type="text" maxlength="40" required aria-label="Имя пользователя"></label><button class="primary" style="margin-top:20px">Сохранить</button></form>`;
        const choose=$('.avatar-pick',root), remove=$('.avatar-remove',root);
        function changeAvatar(action){return guard(async()=>{choose.disabled=remove.disabled=true;try{await action();}finally{choose.disabled=remove.disabled=false;}});}
        choose.onclick=changeAvatar(async()=>{const [file]=await pickFile('image/png,image/jpeg,image/webp');if(file)await updateAvatar(file);});
        remove.onclick=changeAvatar(removeAvatar);
        refreshProfileAvatar();
        $('.user-name',root).value=settings.get('name');$('.user-form',root).onsubmit=e=>{e.preventDefault();settings.set({name:$('.user-name',root).value.trim()||'green'});refreshProfileAvatar();notify('Имя сохранено.');};
      }else if(tab==='data'){
        root.innerHTML=`<h2>Данные под контролем</h2><p style="font-size:12px">Файлы и снимки хранятся в этом браузере, на этом адресе сайта. Очистка данных сайта удаляет их.</p><div class="setting-line"><div><strong>Резервная копия файлов</strong><small>Все папки и документы рабочего стола</small></div><button class="backup">${icon('download')}Экспорт</button></div><div class="setting-line"><div><strong>Восстановить файлы</strong><small>Из архива greenos-files.json</small></div><button class="restore">${icon('upload')}Импорт</button></div><div class="setting-line"><div><strong>Снимок виртуальной машины</strong><small>Сохраняет память Linux и состояние устройств</small></div><button class="open-linux">Открыть Linux</button></div><div class="setting-line"><div><strong>Защита от очистки хранилища</strong><small class="persistent-label">Браузер может запросить разрешение</small></div><button class="persist">Запросить</button></div><p style="margin-top:20px;font-size:11px">Архив файлов и снимок Linux сохраняются отдельно. Для полной резервной копии экспортируйте оба.</p>`;
        $('.backup',root).onclick=guard(exportFiles);$('.restore',root).onclick=guard(async()=>{const [f]=await pickFile('.json');if(f)await importFiles(f);});$('.open-linux',root).onclick=()=>wm.open('linux');$('.persist',root).onclick=guard(async()=>{const granted=await navigator.storage.persist?.();$('.persistent-label',root).textContent=granted?'Постоянное хранилище разрешено':'Браузер не предоставил постоянное хранилище.';});
      }else{
        root.innerHTML=`<div class="about-logo"><img src="/assets/leaf.svg" alt=""><div><h2>GreenOS 2.0</h2><small>LINUX EDITION</small></div></div><p>Рабочий стол в браузере с настоящим Linux внутри виртуальной машины x86.</p><div class="setting-line"><strong>Эмулятор</strong><span class="mono">v86 · WebAssembly</span></div><div class="setting-line"><strong>Linux</strong><span>Buildroot 6.8 / Tiny Core 11</span></div><div class="setting-line"><strong>Архитектура</strong><span>x86, 32 бита</span></div><div class="setting-line"><strong>Терминал</strong><span>xterm.js 5.5.0</span></div><p style="font-size:11px;margin-top:20px">GreenOS — браузерная оболочка и среда запуска. Ядро Linux исполняется в v86. Бинарные программы запускаются внутри гостевой системы; установка пакетов зависит от выбранного дистрибутива и настройки сети.</p><p style="font-size:11px"><a href="https://github.com/copy/v86" target="_blank" rel="noreferrer">v86 ↗</a> · <a href="https://www.tinycorelinux.net/" target="_blank" rel="noreferrer">Tiny Core ↗</a> · <a href="https://buildroot.org/" target="_blank" rel="noreferrer">Buildroot ↗</a></p>`;
      }
    }
    $$('[data-tab]',win.body).forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render();});render();
  }
};
