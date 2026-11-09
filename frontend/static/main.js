import {$, $$, el, icon, settings, on, emit, ask} from './core.js';
import {openDatabase,fs,state} from './storage.js';
import {wm} from './windows.js';
import {linuxApp,linux} from './linux.js';
import {welcomeApp,filesApp,editorApp,viewerApp,settingsApp,monitorApp,openFile,guard} from './apps.js';
import {browserApp} from './browser.js';
import {radioApp} from './radio.js';
import {blocksApp} from './greenblocks.js';
import {calculatorApp,gamesApp,chatApp} from './utilities.js';
import {desktopShortcuts} from './shortcuts.js';
import {loadAvatar,renderAvatar} from './profile.js';
import {documentsApp} from './documents.js';

const apps=[welcomeApp,linuxApp,filesApp,editorApp,documentsApp,browserApp,radioApp,calculatorApp,gamesApp,blocksApp,chatApp,monitorApp,settingsApp,viewerApp];
const transientApps = new Set(['chat', 'viewer', 'blocks', 'office']);
for(const app of apps)wm.register(app);
const notices=[];
function toast({message,error=false}){
  const node=el('div',{class:`toast ${error?'error':''}`});node.innerHTML=icon(error?'info':'check');node.append(el('span',{},message));$('#toast-area').append(node);setTimeout(()=>node.remove(),5000);
  notices.unshift({message,error,time:Date.now()});if(notices.length>30)notices.pop();renderNotifications();
}
function renderNotifications(){const root=$('#notification-list');root.replaceChildren();for(const n of notices){root.append(el('article',{class:'notification'},el('strong',{},n.error?'Не удалось выполнить действие':'GreenOS'),el('p',{},n.message),el('small',{},new Date(n.time).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))));}if(!notices.length)root.append(el('div',{class:'empty'},'Пока всё спокойно.'));}
on('toast',toast);on('storage-error',message=>toast({message,error:true}));
function applyAvatar(){renderAvatar($('#launcher-avatar'));renderAvatar($('.lock-avatar'));}
function applySettings(){const s=settings.all();document.body.dataset.theme=s.theme==='light'?'light':'dark';document.body.classList.toggle('no-animations',!s.animations);document.documentElement.style.setProperty('--accent-color',/^#[a-f\d]{6}$/i.test(s.accent)?s.accent:'#a5d890');$('#desktop').dataset.wallpaper=['hills','midnight','mist','grid'].includes(s.wallpaper)?s.wallpaper:'hills';$('#user-label').textContent=s.name;applyAvatar();}
on('avatar',applyAvatar);
on('settings',applySettings);applySettings();

function closePopovers(except) {
  for (const id of ['launcher', 'notifications', 'calendar', 'context-menu', 'window-overview']) {
    if (id !== except) $('#'+id).hidden = true;
  }
  if (except !== 'window-overview') $('#window-overview-toggle').setAttribute('aria-expanded', 'false');
  if (except !== 'launcher') $('#start-button').setAttribute('aria-expanded','false');
}
let pickingShortcut=false;
function toggle(id, shortcut=false){const n=$('#'+id),hidden=!n.hidden;closePopovers();n.hidden=hidden;if(id==='launcher'&&!hidden){$('#start-button').setAttribute('aria-expanded','true');pickingShortcut=shortcut;$('#app-search').value='';renderLauncher('');$('#app-search').focus();}}
function launch(id,options){closePopovers();return wm.open(id,options);}
const shortcuts=desktopShortcuts($('#desktop-icons'),wm.apps,launch,openFile);
on('shortcut:add',({kind,id})=>shortcuts.add(kind,id));
function renderLauncher(search=''){
  const root=$('#app-list');root.replaceChildren();const available=apps.filter(a=>!a.hidden&&`${a.name} ${a.subtitle} ${a.id} ${a.keywords||''}`.toLowerCase().includes(search.toLowerCase()));
  $('.launcher-caption').firstChild.textContent=pickingShortcut?'ПРИЛОЖЕНИЕ ДЛЯ ЯРЛЫКА ':'ПРИЛОЖЕНИЯ ';
  $('#app-count').textContent=String(available.length);
  for(const app of available){
    const button=el('button',{class:'launcher-app'});
    button.innerHTML=`<span class="app-tile">${icon(app.icon)}</span>`;
    button.append(el('span',{},el('strong',{},app.name),el('small',{},app.subtitle)));
    const add=()=>{closePopovers();shortcuts.add('app',app.id);};
    button.onclick=()=>pickingShortcut?add():launch(app.id);
    button.oncontextmenu=event=>{
      event.preventDefault();
      emit('context',{x:event.clientX,y:event.clientY,items:[{label:'Создать ярлык на рабочем столе',action:add}]});
    };
    root.append(button);
  }
  if(!available.length)root.append(el('div',{class:'empty',style:'grid-column:1/-1'},'Приложение не найдено.'));
}
$('#start-button').onclick=()=>toggle('launcher');$('#app-search').oninput=e=>renderLauncher(e.target.value);$('#app-search').onkeydown=e=>{if(e.key==='Enter')$('.launcher-app')?.click();};
for(const mark of $$('.shell-logo'))mark.innerHTML=icon('leaf');
$('#brand').onclick=()=>launch('welcome');$('#launcher-settings').onclick=()=>launch('settings');
$('#launcher-avatar').onclick=()=>launch('settings',{tab:'user'});
$('#notification-toggle').innerHTML=icon('bell');$('#notification-toggle').onclick=()=>toggle('notifications');$('#clear-notifications').onclick=()=>{notices.length=0;renderNotifications();};renderNotifications();
$('#fullscreen').innerHTML=icon('expand');$('#fullscreen').onclick=guard(async()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen());
$('#lock').innerHTML=icon('lock');
const lockSurfaces=$$('.topbar,.workarea,.panel');
let previousFocus;
const lock=()=>{
  previousFocus=document.activeElement;
  closePopovers();
  for(const surface of lockSurfaces)surface.inert=true;
  $('#lock-screen').hidden=false;
  $('#unlock').focus();
  emit('lock',true);
};
$('#lock').onclick=$('#launcher-lock').onclick=lock;
$('#unlock').onclick=()=>{
  $('#lock-screen').hidden=true;
  for(const surface of lockSurfaces)surface.inert=false;
  const focus=previousFocus?.isConnected&&!previousFocus.closest('[hidden]')?previousFocus:$('#start-button');
  focus.focus({preventScroll:true});
  emit('lock',false);
};
$('#show-desktop').innerHTML=icon('desktop');let desktopHidden=[];
$('#show-desktop').onclick=()=>{if(desktopHidden.length){for(const w of desktopHidden.filter(w=>wm.windows.includes(w)))wm.restore(w);desktopHidden=[];}else{desktopHidden=wm.windows.filter(w=>w.workspace===wm.workspace&&!w.minimized);for(const w of desktopHidden)wm.minimize(w);}};
for(let i=0;i<3;i++){const button=el('button',{title:`Рабочее пространство ${i+1} · Ctrl+Alt+${i+1}`,'aria-label':`Рабочее пространство ${i+1}`},String(i+1));button.onclick=()=>{closePopovers();wm.switchWorkspace(i);};$('.workspace-switch').append(button);}

const overviewToggle = $('#window-overview-toggle');
const overview = $('#window-overview');
overviewToggle.innerHTML = `${icon('grid')}<span>Обзор</span>`;

function renderOverview() {
  const groups = $('#window-overview-groups');
  groups.replaceChildren();
  $('#window-overview-count').textContent = `Всего ${wm.windows.length}`;
  for (let index = 0; index < 3; index++) {
    const title = el('button', {class: 'overview-space-title', 'aria-current': index === wm.workspace ? 'true' : 'false'},
      `Пространство ${index + 1}`);
    title.onclick = () => { closePopovers(); wm.switchWorkspace(index); overviewToggle.focus(); };
    const group = el('section', {class: 'overview-space'}, title);
    const windows = wm.windows.filter(win => win.workspace === index);
    for (const win of windows) {
      const button = el('button', {class: 'overview-window', title: win.title});
      button.innerHTML = icon(win.app.icon);
      button.append(el('span', {}, el('strong', {}, win.title || win.app.name),
        el('small', {}, win.minimized ? 'Свёрнуто' : win === wm.active ? 'Активное окно' : win.app.name)));
      button.onclick = () => { closePopovers(); wm.restore(win); win.element.focus(); };
      group.append(button);
    }
    if (!windows.length) group.append(el('p', {class: 'overview-empty'}, 'Нет открытых окон'));
    groups.append(group);
  }
}

overviewToggle.onclick = () => {
  const opening = overview.hidden;
  closePopovers();
  if (!opening) return;
  renderOverview();
  overview.hidden = false;
  overviewToggle.setAttribute('aria-expanded', 'true');
  $('.overview-space-title[aria-current="true"]', overview)?.focus();
};
on('windows', () => { if (!overview.hidden) renderOverview(); });

for(const id of ['linux','files','editor','browser','radio','settings']){const app=wm.apps.get(id),b=el('button',{title:app.name,'aria-label':app.name});b.innerHTML=icon(app.icon);b.onclick=()=>launch(id);$('#pinned-apps').append(b);}
renderLauncher();wm.renderTasks();

function clock(){const now=new Date();$('#top-clock').textContent=now.toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).replace('.','')+' · '+now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});$('#lock-time').textContent=now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});$('#lock-date').textContent=now.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});}
clock();setInterval(clock,1000);
function network(){const online=navigator.onLine;$('#network').textContent=online?'В сети':'Без сети';$('#network').classList.toggle('offline',!online);}
network();window.addEventListener('online',network);window.addEventListener('offline',network);
function renderCalendar(offset=0){const today=new Date(),date=new Date(today.getFullYear(),today.getMonth()+offset,1);const month=date.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});const root=$('#calendar');root.replaceChildren();const header=el('div',{class:'row',style:'justify-content:space-between;margin-bottom:12px'}),previous=el('button',{class:'icon-button','aria-label':'Предыдущий месяц'},'‹'),next=el('button',{class:'icon-button','aria-label':'Следующий месяц'},'›');header.append(previous,el('h3',{style:'margin:0'},month),next);previous.onclick=()=>renderCalendar(offset-1);next.onclick=()=>renderCalendar(offset+1);root.append(header);const grid=el('div',{class:'calendar-grid'});for(const d of ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'])grid.append(el('span',{class:'weekday'},d));for(let i=0;i<(date.getDay()+6)%7;i++)grid.append(el('span'));const days=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();for(let d=1;d<=days;d++)grid.append(el('span',{class:d===today.getDate()&&offset===0?'today':''},String(d)));root.append(grid);}
$('#top-clock').onclick=()=>{renderCalendar();toggle('calendar');};
on('context',({x,y,items})=>{closePopovers('context-menu');const root=$('#context-menu');root.replaceChildren();for(const item of items){if(item.separator){root.append(el('hr'));continue;}const b=el('button',{role:'menuitem',class:item.danger?'danger':''},item.label);b.onclick=()=>{root.hidden=true;item.action();};root.append(b);}root.hidden=false;root.style.left=`${Math.max(8,Math.min(x,innerWidth-root.offsetWidth-8))}px`;root.style.top=`${Math.max(44,Math.min(y,innerHeight-root.offsetHeight-80))}px`;});
$('#workarea').oncontextmenu=e=>{if(e.target.closest('.os-window,button'))return;e.preventDefault();emit('context',{x:e.clientX,y:e.clientY,items:[{label:'Добавить ярлык приложения…',action:()=>toggle('launcher',true)},{label:'Упорядочить ярлыки',action:()=>shortcuts.arrange()},{separator:true},{label:'Открыть домашнюю папку',action:()=>launch('files',{folder:'home'})},{label:'Изменить оформление',action:()=>launch('settings')},{separator:true},{label:'Заблокировать экран',action:lock}]});};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.popover,#start-button,#notification-toggle,#top-clock,#window-overview-toggle'))closePopovers();});
document.addEventListener('keydown',e=>{
  if(!$('#lock-screen').hidden){
    if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();$('#unlock').click();}
    e.stopImmediatePropagation();
    return;
  }
  if($('#system-dialog').open)return;
  if(e.key==='Escape'){
    const overviewWasOpen = !overview.hidden;
    closePopovers();
    if (overviewWasOpen) overviewToggle.focus();
    return;
  }
  let handled=true;
  if(e.altKey&&e.key==='F1')toggle('launcher');
  else if(e.altKey&&e.key==='Tab')wm.cycle();
  else if(e.altKey&&e.key==='F4'&&wm.active)wm.close(wm.active);
  else if(e.ctrlKey&&e.altKey&&['1','2','3'].includes(e.key))wm.switchWorkspace(Number(e.key)-1);
  else if(e.ctrlKey&&e.key.toLowerCase()==='s'&&wm.active?.save)wm.active.save();
  else handled=false;
  if(handled){e.preventDefault();e.stopImmediatePropagation();}
},true);
window.addEventListener('resize',()=>wm.clamp());
window.addEventListener('beforeunload',e=>{if(linux.vm||wm.windows.some(w=>w.hasUnsavedChanges?.()||(w.app.id==='editor'&&w.serialize?.().draft!=null))){e.preventDefault();e.returnValue='';}});

let sessionTimer,ready=false;
async function saveSession(){if(!ready)return;const session=wm.windows.filter(w=>!transientApps.has(w.app.id)).map(w=>({app:w.app.id,options:w.serialize?.()||w.options,workspace:w.workspace,geometry:w.geometry,maximized:w.maximized,minimized:w.minimized}));try{await state.set('session',session);}catch(e){console.warn('Session save failed',e);}}
on('windows',()=>{clearTimeout(sessionTimer);sessionTimer=setTimeout(saveSession,500);});
document.addEventListener('input',e=>{if(e.target.closest('.editor-area,.document-name')){clearTimeout(sessionTimer);sessionTimer=setTimeout(saveSession,700);}});
window.addEventListener('pagehide',saveSession);
async function init(){
  try{
    await openDatabase();await fs.init();shortcuts.render();
    await loadAvatar().catch(error=>console.warn('Avatar load failed',error));
    const saved=await state.get('session');const workspace=wm.workspace;
    if(Array.isArray(saved)&&saved.length){
      for(const item of saved.slice(0, 15)){
        if(!wm.apps.has(item.app)||transientApps.has(item.app))continue;
        const win=await wm.open(item.app,item.options||{});win.workspace=Number.isInteger(item.workspace)?Math.max(0,Math.min(2,item.workspace)):0;
        if(item.geometry&&['x','y','width','height'].every(k=>Number.isFinite(item.geometry[k]))){win.geometry={...item.geometry};wm.applyGeometry(win);}
        if (item.maximized) wm.maximize(win, false);
        if (item.minimized) wm.minimize(win, false);
      }
      wm.clamp();wm.switchWorkspace(workspace);
    }
    if(!wm.windows.length&&settings.get('welcome'))await wm.open('welcome');
    ready=true;
    notices.unshift({message:'Рабочий стол готов. Linux запускается в отдельной виртуальной машине.',time:Date.now()});renderNotifications();
  }catch(e){console.error(e);toast({message:`Не удалось открыть локальное хранилище: ${e.message}`,error:true});const panel=el('div',{class:'popover',style:'left:50%;top:35%;transform:translateX(-50%);padding:28px;max-width:90vw;width:450px'},el('h2',{},'Не удалось открыть хранилище'),el('p',{},'Разрешите данные сайта и IndexedDB в браузере, затем обновите страницу. Возможно, нужно закрыть старые вкладки GreenOS.'),el('button',{class:'primary',onclick:()=>location.reload()},'Попробовать снова'));$('#desktop').append(panel);}
}
init();
