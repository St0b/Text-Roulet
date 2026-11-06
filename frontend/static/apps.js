import {$, $$, el, icon, settings, on, emit, ask, pickFile, download, bytes, escapeHTML} from './core.js';
import {fs, state, transaction} from './storage.js';
import {wm} from './windows.js';
import {linux, sendToLinux, receiveFromLinux} from './linux.js';

export const guard = callback => async(...args)=>{try{return await callback(...args);}catch(e){console.error(e);emit('toast',{message:e.message||'Операция не выполнена',error:true});}};
const notify=message=>emit('toast',{message});
export function openFile(node) {
  if(!node){notify('Файл не найден.');return;}
  if(node.type==='dir')return wm.open('files',{folder:node.id});
  if(/^(image|audio|video)\//.test(node.mime))return wm.open('viewer',{id:node.id});
  if(node.data.byteLength>2*1024*1024){download(node.name,node.data,node.mime);return;}
  return wm.open('editor',{id:node.id});
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

export const filesApp={id:'files',name:'Файлы',subtitle:'Папки и обмен с Linux',icon:'files',width:855,height:555,
  mount(win,options={}){
    let folder=options.folder||'home',selected=null,history=[],filter='';
    win.body.innerHTML=`<div class="toolbar"><button class="go-back icon-button" title="Назад" aria-label="Назад">${icon('back')}</button><button class="go-up icon-button" title="На уровень выше" aria-label="На уровень выше">${icon('up')}</button><div class="file-address"></div><input class="file-search" type="search" placeholder="Поиск…" aria-label="Поиск файлов"></div><div class="app-layout"><aside class="sidebar"><div class="sidebar-label">МЕСТА</div>${[['home','home','Домашняя папка'],['desktop','desktop','Рабочий стол'],['documents','editor','Документы'],['downloads','download','Загрузки'],['pictures','image','Изображения'],['shared','linux','Обмен с Linux'],['trash','trash','Корзина']].map(([id,i,t])=>`<button data-folder="${id}" title="${t}">${icon(i)}<span>${t}</span></button>`).join('')}</aside><main class="app-main" style="display:flex;flex-direction:column"><div class="file-operations"><button class="new-folder">${icon('plus')}Папка</button><button class="new-file">${icon('editor')}Файл</button><button class="import-files">${icon('upload')}Загрузить</button><button class="linux-pull">${icon('download')}Из Linux</button><button class="selected-action" disabled>Действия ⋯</button></div><div class="file-grid" tabindex="0" aria-label="Содержимое папки"></div></main></div><div class="statusbar"><span class="file-count"></span><span class="spacer"></span><span class="file-storage">IndexedDB · локальные файлы</span></div>`;
    const q=s=>$(s,win.body),grid=q('.file-grid');
    const enter=id=>{if(id!==folder)history.push(folder);folder=id;selected=null;filter='';q('.file-search').value='';render();};
    function actions(node){return folder==='trash'?[
      {label:'Восстановить',action:guard(()=>fs.restore(node.id))},
      {label:'Удалить навсегда',danger:true,action:guard(async()=>{if(await ask('Удалить навсегда?',{message:node.name,confirm:true,ok:'Удалить'}))await fs.remove(node.id);})},
    ]:[
      {label:'Открыть',action:()=>openFile(node)},
      ...(node.type==='file'?[{label:'Скачать',action:()=>download(node.name,node.data,node.mime)},{label:'Отправить в Linux /mnt',action:guard(()=>sendToLinux(node))}]:[]),
      {label:'Переименовать',action:guard(async()=>{const name=await ask('Переименовать',{value:node.name});if(name)await fs.rename(node.id,name);})},
      {label:'В корзину',danger:true,action:guard(()=>fs.trash(node.id))},
    ];}
    function context(event,node){event.preventDefault();selected=node.id;render();emit('context',{x:event.clientX,y:event.clientY,items:actions(node)});}
    function render(){
      if(folder!=='trash'&&(!fs.get(folder)||fs.isTrashed(fs.get(folder))))folder='home';
      win.setTitle(`${folder==='trash'?'Корзина':fs.get(folder).name} — Файлы`);
      q('.file-address').replaceChildren();
      for(const node of folder==='trash'?[{id:'trash',name:'Корзина'}]:fs.path(folder)){
        const button=el('button',{},node.id==='home'?'Домашняя':node.name);button.onclick=()=>enter(node.id);q('.file-address').append(button,el('span',{class:'muted'},'›'));
      }
      $$('[data-folder]',win.body).forEach(b=>b.classList.toggle('active',b.dataset.folder===folder));
      q('.go-back').disabled=!history.length;q('.go-up').disabled=folder==='home'||folder==='trash';
      const list=fs.list(folder,folder==='trash').filter(n=>n.name.toLowerCase().includes(filter));grid.replaceChildren();
      for(const node of list){
        const b=el('button',{class:`file-card ${node.type} ${selected===node.id?'selected':''}`,draggable:folder!=='trash','aria-label':node.name});
        b.innerHTML=icon(node.type==='dir'?'files':node.mime?.startsWith('image/')?'image':'editor');b.append(el('strong',{},node.name),el('small',{},node.type==='dir'?'Папка':bytes(node.data.byteLength)));
        b.onclick=()=>{selected=node.id;render();};b.ondblclick=()=>folder==='trash'?null:openFile(node);b.oncontextmenu=e=>context(e,node);
        b.ondragstart=e=>{e.dataTransfer.setData('application/x-greenos-file',node.id);e.dataTransfer.effectAllowed='move';};
        if(node.type==='dir'){
          b.ondragover=e=>{e.preventDefault();e.stopPropagation();};
          b.ondrop=guard(async e=>{e.preventDefault();e.stopPropagation();const id=e.dataTransfer.getData('application/x-greenos-file');if(id)await fs.move(id,node.id);else for(const file of e.dataTransfer.files)await fs.import(file,node.id);});
        }
        grid.append(b);
      }
      if(!list.length)grid.append(el('div',{class:'empty',style:'grid-column:1/-1'},el('h3',{},filter?'Ничего не найдено':folder==='trash'?'Корзина пуста':'Папка пуста'),el('p',{},folder==='shared'?'Загрузите файл или заберите его из Linux /mnt.':'Создавайте файлы или перетащите их сюда.')));
      q('.file-count').textContent=`Объектов: ${list.length}${selected&&fs.get(selected)?` · ${fs.get(selected).name}`:''}`;
      q('.selected-action').disabled=!selected||!fs.get(selected);
      for(const selector of ['.new-folder','.new-file','.import-files'])q(selector).disabled=folder==='trash';
      win.options={folder};
    }
    q('.go-back').onclick=()=>{folder=history.pop()||'home';selected=null;render();};q('.go-up').onclick=()=>enter(fs.get(folder)?.parent||'home');
    $$('[data-folder]',win.body).forEach(b=>b.onclick=()=>enter(b.dataset.folder));
    q('.file-search').oninput=e=>{filter=e.target.value.toLowerCase();render();};
    q('.new-folder').onclick=guard(async()=>{const name=await ask('Новая папка',{value:'Новая папка',ok:'Создать'});if(name)await fs.mkdir(folder,name);});
    q('.new-file').onclick=guard(async()=>{const name=await ask('Новый файл',{value:'Новый документ.txt',ok:'Создать'});if(name)openFile(await fs.write(folder,name,new Uint8Array()));});
    q('.import-files').onclick=guard(async()=>{for(const file of await pickFile('',true))await fs.import(file,folder);notify('Файлы загружены.');});
    q('.linux-pull').onclick=guard(async()=>{const name=await ask('Забрать файл из Linux',{message:'Путь в общей файловой системе 9p (Buildroot: /mnt).',value:'/mnt/hello.txt',ok:'Забрать'});if(name)await receiveFromLinux(name);});
    q('.selected-action').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();emit('context',{x:r.left,y:r.bottom+4,items:actions(fs.get(selected))});};
    grid.ondragover=e=>{if(folder==='trash')return;e.preventDefault();grid.classList.add('file-drop');};grid.ondragleave=()=>grid.classList.remove('file-drop');
    grid.ondrop=guard(async e=>{e.preventDefault();grid.classList.remove('file-drop');if(folder==='trash')return;const id=e.dataTransfer.getData('application/x-greenos-file');if(id)await fs.move(id,folder);else for(const file of e.dataTransfer.files)await fs.import(file,folder);});
    grid.onkeydown=guard(async e=>{if(!selected)return;if(e.key==='Enter'){e.preventDefault();openFile(fs.get(selected));}if(e.key==='Delete'&&folder!=='trash'){e.preventDefault();await fs.trash(selected);selected=null;}});
    on('files',render,win.abort.signal);render();win.serialize=()=>({folder});
  }
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
  mount(win){
    win.body.innerHTML=`<div class="app-layout"><aside class="sidebar"><div class="sidebar-label">GREENOS</div>${[['appearance','image','Оформление'],['user','home','Пользователь'],['data','files','Данные'],['about','info','О системе']].map(([id,i,t])=>`<button data-tab="${id}">${icon(i)}<span>${t}</span></button>`).join('')}</aside><main class="app-main settings-main"></main></div>`;
    const root=$('.settings-main',win.body);let tab='appearance';
    function render(){
      $$('[data-tab]',win.body).forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
      if(tab==='appearance'){
        root.innerHTML=`<h2>Сделайте GreenOS своей</h2><p style="font-size:11px">Немного цвета. Немного вас.</p><h3>Обои рабочего стола</h3><div class="wallpaper-options">${[['hills','Зелёные холмы'],['midnight','Полночь'],['mist','Туман'],['grid','Сетка']].map(([id,n])=>`<button class="wallpaper-choice ${settings.get('wallpaper')===id?'active':''}" data-wallpaper="${id}"><div class="sample"></div><small>${n}</small></button>`).join('')}</div><div class="setting-line"><div><strong>Тема интерфейса</strong><small>Для всех окон рабочего стола</small></div><select class="theme-choice" aria-label="Тема"><option value="dark">Тёмная</option><option value="light">Светлая</option></select></div><div class="setting-line"><div><strong>Акцентный цвет</strong><small>Выделения и элементы управления</small></div><div class="accent-options">${['#a5d890','#8fcac5','#d8c38f','#bdabe4'].map(c=>`<button data-color="${c}" style="background:${c}" title="${c}" aria-label="Цвет ${c}" class="${settings.get('accent')===c?'active':''}"></button>`).join('')}</div></div><label class="setting-line"><div><strong>Анимации</strong><small>Плавное открытие окон</small></div><input class="animations-choice" type="checkbox" ${settings.get('animations')?'checked':''}></label>`;
        $$('.wallpaper-choice',root).forEach(b=>b.onclick=()=>{settings.set({wallpaper:b.dataset.wallpaper});render();});
        $('.theme-choice',root).value=settings.get('theme');$('.theme-choice',root).onchange=e=>settings.set({theme:e.target.value});
        $$('[data-color]',root).forEach(b=>b.onclick=()=>{settings.set({accent:b.dataset.color});render();});$('.animations-choice',root).onchange=e=>settings.set({animations:e.target.checked});
      }else if(tab==='user'){
        root.innerHTML=`<h2>Ваше пространство</h2><p style="font-size:12px">Имя локального профиля рабочего стола. Учётная запись Linux управляется внутри гостевой системы.</p><form class="user-form"><label class="setting-line"><div><strong>Имя пользователя</strong><small>Отображается в меню GreenOS</small></div><input class="user-name" type="text" maxlength="40" required aria-label="Имя пользователя"></label><button class="primary" style="margin-top:20px">Сохранить</button></form><div class="separator"></div><p style="font-size:11px">Экран блокировки скрывает рабочий стол. Парольную защиту и пользователей Linux настраивайте в самой виртуальной машине.</p>`;
        $('.user-name',root).value=settings.get('name');$('.user-form',root).onsubmit=e=>{e.preventDefault();settings.set({name:$('.user-name',root).value.trim()||'green'});notify('Имя сохранено.');};
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

export const browserApp={id:'browser',name:'Интернет',subtitle:'Адреса и закладки',icon:'globe',width:810,height:560,
  mount(win){win.body.innerHTML=`<form class="toolbar address-form"><span>${icon('globe')}</span><input class="grow web-address" type="text" placeholder="Адрес сайта или поисковый запрос" aria-label="Адрес сайта"><button class="primary">Открыть ↗</button></form><div class="browser-page"><span class="badge green">GREENOS / WEB</span><h1 style="margin-top:22px">Окно в открытый мир.</h1><p>Найдите ответ, откройте документацию или исследуйте Linux.</p><div class="bookmark-grid">${[['Linux Kernel','kernel.org','https://kernel.org/'],['Tiny Core','tinycorelinux.net','https://www.tinycorelinux.net/'],['Buildroot','buildroot.org','https://buildroot.org/'],['v86','github.com/copy/v86','https://github.com/copy/v86']].map(([name,domain,url])=>`<a class="bookmark" href="${url}" target="_blank" rel="noreferrer"><strong>${name} ↗</strong><small>${domain}</small></a>`).join('')}</div><div class="browser-note">Сайты открываются в новой вкладке браузера: большинство сайтов запрещают встраивание в чужие окна. В графическом Linux браузер работает внутри виртуальной машины и использует её сетевое подключение.</div></div>`;
    $('.address-form',win.body).onsubmit=e=>{e.preventDefault();const value=$('.web-address',win.body).value.trim();if(!value)return;let url;if(/^https?:\/\//i.test(value))url=value;else if(/^[\w.-]+\.[a-z]{2,}([/:]|$)/i.test(value))url='https://'+value;else url='https://www.google.com/search?q='+encodeURIComponent(value);window.open(url,'_blank','noopener,noreferrer');};}
};
