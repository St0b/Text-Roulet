import {$, $$, el, icon, settings, emit, ask} from './core.js';

export class WindowManager {
  apps = new Map(); windows = []; active = null; sequence = 0; z = 20;
  workspace = settings.get('workspace');
  register(app) {this.apps.set(app.id, app);}
  async open(appId, options = {}) {
    const app=this.apps.get(appId); if(!app)return;
    if(app.singleton) {const existing=this.windows.find(w=>w.app.id===appId);if(existing){this.switchWorkspace(existing.workspace);this.restore(existing);await existing.activate?.(options);return existing;}}
    const bounds=$('#workarea').getBoundingClientRect(), offset=(this.windows.length%5)*24;
    const width=Math.min(app.width||800,bounds.width-24),height=Math.min(app.height||540,bounds.height-24);
    const abort=new AbortController();
    const win={id:++this.sequence,app,options,workspace:this.workspace,minimized:false,maximized:false,abort,cleanup:()=>{},
      geometry:{x:Math.max(6,Math.min(bounds.width-width-6,(bounds.width-width)/2+offset)),y:Math.max(6,Math.min(bounds.height-height-6,(bounds.height-height)/2+offset-12)),width,height}};
    win.element=el('section',{class:'os-window', 'data-app':appId,tabindex:'-1',role:'region','aria-label':app.name});
    win.element.innerHTML=`<header class="titlebar"><span class="title-icon">${icon(app.icon)}</span><span class="window-name"></span><div class="titlebar-actions"><button data-action="move" title="На следующее рабочее пространство" aria-label="На следующее рабочее пространство">⇥</button><button data-action="minimize" title="Свернуть" aria-label="Свернуть">−</button><button data-action="maximize" title="Развернуть" aria-label="Развернуть">□</button><button data-action="close" title="Закрыть" aria-label="Закрыть">×</button></div></header><div class="window-content"></div><div class="resize-handle" aria-hidden="true"></div>`;
    win.body=$('.window-content',win.element);
    win.setTitle=title=>{$('.window-name',win.element).textContent=title;win.title=title;this.renderTasks();};
    win.setTitle(app.name);
    win.on=(type,cb)=>win.element.addEventListener(type,cb,{signal:abort.signal});
    this.windows.push(win);$('#windows').append(win.element);this.applyGeometry(win);this.focus(win);
    win.on('pointerdown',()=>this.focus(win));
    for(const b of $$('.titlebar-actions button',win.element))b.onclick=()=>({close:()=>this.close(win),minimize:()=>this.minimize(win),maximize:()=>this.maximize(win),move:()=>{win.workspace=(win.workspace+1)%3;this.switchWorkspace(win.workspace);this.focus(win);}}[b.dataset.action]());
    const head=$('.titlebar',win.element);head.ondblclick=e=>{if(!e.target.closest('button'))this.maximize(win);};
    this.bindDrag(win,head,false);this.bindDrag(win,$('.resize-handle',win.element),true);
    try {const cleanup=await app.mount(win,options);if(typeof cleanup==='function'){if(abort.signal.aborted)await cleanup();else win.cleanup=cleanup;}}catch(e){win.body.replaceChildren(el('div',{class:'app-error'},el('h2',{},'Не удалось открыть приложение'),el('p',{},e.message)));console.error(e);}
    if(abort.signal.aborted)return win;
    this.renderTasks();this.changed();return win;
  }
  applyGeometry(win) {const g=win.geometry;Object.assign(win.element.style,{left:`${g.x}px`,top:`${g.y}px`,width:`${g.width}px`,height:`${g.height}px`});}
  focus(win) {if(!this.windows.includes(win))return;this.active=win;win.element.style.zIndex=++this.z;for(const w of this.windows)w.element.classList.toggle('focused',w===win);this.renderTasks();emit('focus',win);}
  minimize(win) {win.minimized=true;win.element.hidden=true;if(this.active===win)this.focusNext(win);this.renderTasks();this.changed();}
  restore(win) {if(win.workspace!==this.workspace)this.switchWorkspace(win.workspace);win.minimized=false;win.element.hidden=false;this.focus(win);win.element.dispatchEvent(new Event('resize'));this.changed();}
  maximize(win) {win.maximized=!win.maximized;win.element.classList.toggle('maximized',win.maximized);this.focus(win);win.element.dispatchEvent(new Event('resize'));this.changed();}
  async close(win, force=false) {if(!force&&win.beforeClose&&!await win.beforeClose())return;win.abort.abort();await win.cleanup();win.element.remove();this.windows=this.windows.filter(w=>w!==win);if(this.active===win)this.focusNext(win);this.renderTasks();this.changed();}
  focusNext(except) {const next=this.windows.filter(w=>w!==except&&!w.minimized&&w.workspace===this.workspace).sort((a,b)=>Number(b.element.style.zIndex)-Number(a.element.style.zIndex))[0];this.active=null;if(next)this.focus(next);else emit('focus',null);}
  switchWorkspace(index) {this.workspace=index;settings.set({workspace:index});for(const w of this.windows)w.element.hidden=w.minimized||w.workspace!==index;this.focusNext(null);this.renderTasks();this.changed();}
  cycle() {const visible=this.windows.filter(w=>w.workspace===this.workspace);if(!visible.length)return;const index=visible.indexOf(this.active);this.restore(visible[(index+1)%visible.length]);}
  bindDrag(win,handle,resize) {
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target.closest('button')||win.maximized||innerWidth<640)return;
      event.preventDefault();this.focus(win);const initial={...win.geometry},x=event.clientX,y=event.clientY;
      handle.setPointerCapture(event.pointerId);win.element.classList.add('moving');
      const move=e=>{const area=$('#workarea');const dx=e.clientX-x,dy=e.clientY-y;
        if(resize){win.geometry.width=Math.min(area.clientWidth-win.geometry.x,Math.max(360,initial.width+dx));win.geometry.height=Math.min(area.clientHeight-win.geometry.y,Math.max(260,initial.height+dy));}
        else{win.geometry.x=Math.min(area.clientWidth-80,Math.max(0,initial.x+dx));win.geometry.y=Math.min(area.clientHeight-45,Math.max(0,initial.y+dy));}
        this.applyGeometry(win);win.element.dispatchEvent(new Event('resize'));};
      const stop=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);win.element.classList.remove('moving');this.changed();};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop,{once:true});handle.addEventListener('pointercancel',stop,{once:true});
    });
  }
  renderTasks() {
    const target=$('#tasks');target.replaceChildren();
    for(const w of this.windows.filter(w=>w.workspace===this.workspace)){
      const b=el('button',{class:`task ${!w.minimized&&this.active===w?'active':''}`,title:w.title||w.app.name});
      b.innerHTML=`${icon(w.app.icon)}<span></span>`;$('span',b).textContent=w.title||w.app.name;
      b.onclick=()=>!w.minimized&&this.active===w?this.minimize(w):this.restore(w);target.append(b);
    }
    $$('.workspace-switch button').forEach((b,i)=>{b.classList.toggle('active',i===this.workspace);b.classList.toggle('occupied',this.windows.some(w=>w.workspace===i));});
  }
  changed() {emit('windows',this.windows);}
  clamp() {const a=$('#workarea');for(const w of this.windows){w.geometry.width=Math.min(w.geometry.width,a.clientWidth-12);w.geometry.height=Math.min(w.geometry.height,a.clientHeight-12);w.geometry.x=Math.max(0,Math.min(w.geometry.x,a.clientWidth-w.geometry.width));w.geometry.y=Math.max(0,Math.min(w.geometry.y,a.clientHeight-w.geometry.height));this.applyGeometry(w);}}
}
export const wm=new WindowManager();
