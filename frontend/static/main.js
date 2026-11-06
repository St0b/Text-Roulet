import {$, $$, el, icon, settings, on, emit, ask} from './core.js';
import {openDatabase,fs,state} from './storage.js';
import {wm} from './windows.js';
import {linuxApp,linux} from './linux.js';
import {welcomeApp,filesApp,editorApp,viewerApp,settingsApp,monitorApp,browserApp,guard} from './apps.js';
import {calculatorApp,gamesApp,chatApp} from './utilities.js';

const apps=[welcomeApp,linuxApp,filesApp,editorApp,browserApp,calculatorApp,gamesApp,chatApp,monitorApp,settingsApp,viewerApp];
for(const app of apps)wm.register(app);
const notices=[];
function toast({message,error=false}){
  const node=el('div',{class:`toast ${error?'error':''}`});node.innerHTML=icon(error?'info':'check');node.append(el('span',{},message));$('#toast-area').append(node);setTimeout(()=>node.remove(),5000);
  notices.unshift({message,error,time:Date.now()});if(notices.length>30)notices.pop();renderNotifications();
}
function renderNotifications(){const root=$('#notification-list');root.replaceChildren();for(const n of notices){root.append(el('article',{class:'notification'},el('strong',{},n.error?'Не удалось выполнить действие':'GreenOS'),el('p',{},n.message),el('small',{},new Date(n.time).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))));}if(!notices.length)root.append(el('div',{class:'empty'},'Пока всё спокойно.'));}
on('toast',toast);on('storage-error',message=>toast({message,error:true}));
function applySettings(){const s=settings.all();document.body.dataset.theme=s.theme==='light'?'light':'dark';document.body.classList.toggle('no-animations',!s.animations);document.documentElement.style.setProperty('--accent',/^#[a-f\d]{6}$/i.test(s.accent)?s.accent:'#a5d890');$('#desktop').dataset.wallpaper=['hills','midnight','mist','grid'].includes(s.wallpaper)?s.wallpaper:'hills';$('#user-label').textContent=s.name;}
on('settings',applySettings);applySettings();

function closePopovers(except){for(const id of ['launcher','notifications','calendar','context-menu'])if(id!==except)$('#'+id).hidden=true;}
function toggle(id){const n=$('#'+id),hidden=!n.hidden;closePopovers();n.hidden=hidden;if(id==='launcher'&&!hidden){$('#app-search').value='';renderLauncher('');$('#app-search').focus();}}
function launch(id,options){closePopovers();return wm.open(id,options);}
function renderLauncher(search=''){
  const root=$('#app-list');root.replaceChildren();const available=apps.filter(a=>!a.hidden&&`${a.name} ${a.subtitle} ${a.id}`.toLowerCase().includes(search.toLowerCase()));
  $('#app-count').textContent=String(available.length);
  for(const app of available){const button=el('button',{class:'launcher-app'});button.innerHTML=`<span class="app-tile">${icon(app.icon)}</span>`;button.append(el('span',{},el('strong',{},app.name),el('small',{},app.subtitle)));button.onclick=()=>launch(app.id);root.append(button);}
  if(!available.length)root.append(el('div',{class:'empty',style:'grid-column:1/-1'},'Приложение не найдено.'));
}
$('#start-button').onclick=()=>toggle('launcher');$('#app-search').oninput=e=>renderLauncher(e.target.value);$('#app-search').onkeydown=e=>{if(e.key==='Enter')$('.launcher-app')?.click();};
$('#brand').onclick=()=>launch('welcome');$('#launcher-settings').onclick=()=>launch('settings');
$('#notification-toggle').innerHTML=icon('bell');$('#notification-toggle').onclick=()=>toggle('notifications');$('#clear-notifications').onclick=()=>{notices.length=0;renderNotifications();};renderNotifications();
$('#fullscreen').innerHTML=icon('expand');$('#fullscreen').onclick=guard(async()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen());
$('#lock').innerHTML=icon('lock');const lock=()=>{closePopovers();$('#lock-screen').hidden=false;emit('lock',true);};$('#lock').onclick=$('#launcher-lock').onclick=lock;$('#unlock').onclick=()=>{$('#lock-screen').hidden=true;emit('lock',false);};
$('#show-desktop').innerHTML=icon('desktop');let desktopHidden=[];
$('#show-desktop').onclick=()=>{if(desktopHidden.length){for(const w of desktopHidden.filter(w=>wm.windows.includes(w)))wm.restore(w);desktopHidden=[];}else{desktopHidden=wm.windows.filter(w=>w.workspace===wm.workspace&&!w.minimized);for(const w of desktopHidden)wm.minimize(w);}};
for(let i=0;i<3;i++){const button=el('button',{title:`Рабочее пространство ${i+1} · Ctrl+Alt+${i+1}`,'aria-label':`Рабочее пространство ${i+1}`},String(i+1));button.onclick=()=>{closePopovers();wm.switchWorkspace(i);};$('.workspace-switch').append(button);}
for(const [id,label,options] of [['files','Домашняя папка',{folder:'home'}],['linux','Linux',{}],['editor','Редактор',{}],['files','Корзина',{folder:'trash'}]]){
  const app=wm.apps.get(id);const b=el('button',{class:'desktop-icon','data-app':label==='Корзина'?'trash':id});b.innerHTML=`<span class="app-icon">${icon(label==='Корзина'?'trash':app.icon)}</span>`;b.append(el('span',{},label));b.onclick=()=>launch(id,options);$('#desktop-icons').append(b);
}
for(const id of ['linux','files','editor','browser','settings']){const app=wm.apps.get(id),b=el('button',{title:app.name,'aria-label':app.name});b.innerHTML=icon(app.icon);b.onclick=()=>launch(id);$('#pinned-apps').append(b);}
renderLauncher();wm.renderTasks();

function clock(){const now=new Date();$('#top-clock').textContent=now.toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).replace('.','')+' · '+now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});$('#lock-time').textContent=now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});$('#lock-date').textContent=now.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});}
clock();setInterval(clock,1000);
function network(){const online=navigator.onLine;$('#network').textContent=online?'В сети':'Без сети';$('#network').classList.toggle('offline',!online);}
network();window.addEventListener('online',network);window.addEventListener('offline',network);
function renderCalendar(offset=0){const today=new Date(),date=new Date(today.getFullYear(),today.getMonth()+offset,1);const month=date.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});const root=$('#calendar');root.replaceChildren();const header=el('div',{class:'row',style:'justify-content:space-between;margin-bottom:12px'}),previous=el('button',{class:'icon-button','aria-label':'Предыдущий месяц'},'‹'),next=el('button',{class:'icon-button','aria-label':'Следующий месяц'},'›');header.append(previous,el('h3',{style:'margin:0'},month),next);previous.onclick=()=>renderCalendar(offset-1);next.onclick=()=>renderCalendar(offset+1);root.append(header);const grid=el('div',{class:'calendar-grid'});for(const d of ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'])grid.append(el('span',{class:'weekday'},d));for(let i=0;i<(date.getDay()+6)%7;i++)grid.append(el('span'));const days=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();for(let d=1;d<=days;d++)grid.append(el('span',{class:d===today.getDate()&&offset===0?'today':''},String(d)));root.append(grid);}
$('#top-clock').onclick=()=>{renderCalendar();toggle('calendar');};
on('context',({x,y,items})=>{closePopovers('context-menu');const root=$('#context-menu');root.replaceChildren();for(const item of items){if(item.separator){root.append(el('hr'));continue;}const b=el('button',{role:'menuitem',class:item.danger?'danger':''},item.label);b.onclick=()=>{root.hidden=true;item.action();};root.append(b);}root.hidden=false;root.style.left=`${Math.max(8,Math.min(x,innerWidth-root.offsetWidth-8))}px`;root.style.top=`${Math.max(44,Math.min(y,innerHeight-root.offsetHeight-80))}px`;});
$('#workarea').oncontextmenu=e=>{if(e.target.closest('.os-window,button'))return;e.preventDefault();emit('context',{x:e.clientX,y:e.clientY,items:[{label:'Открыть домашнюю папку',action:()=>launch('files')},{label:'Запустить Linux',action:()=>launch('linux')},{separator:true},{label:'Изменить оформление',action:()=>launch('settings')},{label:'Системный монитор',action:()=>launch('monitor')},{separator:true},{label:'Заблокировать экран',action:lock}]});};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.popover,#start-button,#notification-toggle,#top-clock'))closePopovers();});
document.addEventListener('keydown',e=>{
  if(!$('#lock-screen').hidden){if(e.key==='Enter'||e.key==='Escape')$('#unlock').click();return;}
  if($('#system-dialog').open)return;
  if(e.key==='Escape'){closePopovers();return;}
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
window.addEventListener('beforeunload',e=>{if(linux.vm||wm.windows.some(w=>w.app.id==='editor'&&w.serialize?.().draft!=null)){e.preventDefault();e.returnValue='';}});

let sessionTimer,ready=false;
async function saveSession(){if(!ready)return;const session=wm.windows.filter(w=>w.app.id!=='chat'&&w.app.id!=='viewer').map(w=>({app:w.app.id,options:w.serialize?.()||w.options,workspace:w.workspace,geometry:w.geometry,maximized:w.maximized,minimized:w.minimized}));try{await state.set('session',session);}catch(e){console.warn('Session save failed',e);}}
on('windows',()=>{clearTimeout(sessionTimer);sessionTimer=setTimeout(saveSession,500);});
document.addEventListener('input',e=>{if(e.target.closest('.editor-area,.document-name')){clearTimeout(sessionTimer);sessionTimer=setTimeout(saveSession,700);}});
window.addEventListener('pagehide',saveSession);
async function init(){
  try{
    await openDatabase();await fs.init();
    const saved=await state.get('session');const workspace=wm.workspace;
    if(Array.isArray(saved)&&saved.length){
      for(const item of saved.slice(0,15)){
        if(!wm.apps.has(item.app)||item.app==='viewer'||item.app==='chat')continue;
        const win=await wm.open(item.app,item.options||{});win.workspace=Number.isInteger(item.workspace)?Math.max(0,Math.min(2,item.workspace)):0;
        if(item.geometry&&['x','y','width','height'].every(k=>Number.isFinite(item.geometry[k]))){win.geometry={...item.geometry};wm.applyGeometry(win);}
        if(item.maximized)wm.maximize(win);if(item.minimized)wm.minimize(win);
      }
      wm.clamp();wm.switchWorkspace(workspace);
    }
    if(!wm.windows.length&&settings.get('welcome'))await wm.open('welcome');
    ready=true;
    notices.unshift({message:'Рабочий стол готов. Linux запускается в отдельной виртуальной машине.',time:Date.now()});renderNotifications();
  }catch(e){console.error(e);toast({message:`Не удалось открыть локальное хранилище: ${e.message}`,error:true});const panel=el('div',{class:'popover',style:'left:50%;top:35%;transform:translateX(-50%);padding:28px;max-width:90vw;width:450px'},el('h2',{},'Не удалось открыть хранилище'),el('p',{},'Разрешите данные сайта и IndexedDB в браузере, затем обновите страницу. Возможно, нужно закрыть старые вкладки GreenOS.'),el('button',{class:'primary',onclick:()=>location.reload()},'Попробовать снова'));$('#desktop').append(panel);}
}
init();
