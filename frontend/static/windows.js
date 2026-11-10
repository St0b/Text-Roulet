import {$, $$, el, icon, settings, emit, on} from './core.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionEnabled = () => settings.get('animations') && !reducedMotion.matches;

function currentFrame(win) {
  if (!win.motion && !win.element.classList.contains('opening')) return null;
  const {transform, opacity} = getComputedStyle(win.element);
  return {transform, opacity};
}

function taskButton(appId) {
  return $(`#tasks [data-app-id="${CSS.escape(appId)}"]`);
}

function taskFrame(win) {
  const bounds = win.element.getBoundingClientRect();
  const panel = $('.panel').getBoundingClientRect();
  const task = taskButton(win.app.id)?.getBoundingClientRect() ?? panel;
  const x = Math.max(panel.left + 16, Math.min(panel.right - 16, task.left + task.width / 2));
  const dx = x - (bounds.left + bounds.width / 2);
  const dy = task.top + task.height / 2 - (bounds.top + bounds.height / 2);
  return {transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: 0};
}

function windowCount(count) {
  const last = count % 10, tens = count % 100;
  return `${count} ${tens >= 11 && tens <= 14 ? 'окон' : last === 1 ? 'окно' : last >= 2 && last <= 4 ? 'окна' : 'окон'}`;
}

export class WindowManager {
  apps = new Map(); windows = []; active = null; sequence = 0; z = 20;
  workspace = settings.get('workspace');
  taskGroupApp = null;
  taskGroupMenu = null;
  register(app) {this.apps.set(app.id, app);}
  async open(appId, options = {}) {
    const app=this.apps.get(appId); if(!app)return;
    if(app.singleton) {const existing=this.windows.find(w=>w.app.id===appId);if(existing){this.restore(existing);await existing.activate?.(options);return existing;}}
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
    if (motionEnabled()) {
      win.element.classList.add('opening');
      const finishOpening = event => {
        if (event.target === win.element && event.animationName === 'window-in') {
          win.element.classList.remove('opening');
        }
      };
      win.on('animationend', finishOpening);
      win.on('animationcancel', finishOpening);
    }
    this.windows.push(win);$('#windows').append(win.element);this.applyGeometry(win);this.focus(win);
    win.on('pointerdown',()=>this.focus(win));
    win.on('focusin',()=>{
      if(this.active!==win&&!win.minimized&&!win.element.hidden&&win.workspace===this.workspace)this.focus(win);
    });
    for(const b of $$('.titlebar-actions button',win.element))b.onclick=()=>({close:()=>this.close(win),minimize:()=>this.minimize(win),maximize:()=>this.maximize(win),move:()=>{win.workspace=(win.workspace+1)%3;this.switchWorkspace(win.workspace);this.focus(win);}}[b.dataset.action]());
    const head=$('.titlebar',win.element);head.ondblclick=e=>{if(!e.target.closest('button'))this.maximize(win);};
    this.bindDrag(win,head,false);this.bindDrag(win,$('.resize-handle',win.element),true);
    try {const cleanup=await app.mount(win,options);if(typeof cleanup==='function'){if(abort.signal.aborted)await cleanup();else win.cleanup=cleanup;}}catch(e){win.body.replaceChildren(el('div',{class:'app-error'},el('h2',{},'Не удалось открыть приложение'),el('p',{},e.message)));console.error(e);}
    if(abort.signal.aborted)return win;
    this.renderTasks();this.changed();return win;
  }
  applyGeometry(win) {const g=win.geometry;Object.assign(win.element.style,{left:`${g.x}px`,top:`${g.y}px`,width:`${g.width}px`,height:`${g.height}px`});}
  cancelMotion(win) {
    const motion = win.motion;
    win.motion = null;
    motion?.cancel();
  }
  settleMotions() {
    for (const win of this.windows) {
      if (!win.motion) continue;
      this.cancelMotion(win);
      win.element.hidden = win.minimized || win.workspace !== this.workspace;
    }
  }
  animateWindow(win, frames, duration, finish) {
    const motion = win.element.animate(frames, {duration, easing: 'cubic-bezier(.24,.76,.28,1)', fill: 'both'});
    win.motion = motion;
    motion.onfinish = () => {
      if (win.motion !== motion) return;
      finish?.();
      this.cancelMotion(win);
    };
  }
  setMaximized(win, maximized) {
    win.maximized = maximized;
    win.element.classList.toggle('maximized', maximized);
    const button = $('[data-action="maximize"]', win.element);
    button.title = maximized ? 'Вернуть размер окна' : 'Развернуть';
    button.setAttribute('aria-label', button.title);
  }
  tilePair(left, right) {
    const area = $('#workarea');
    const gap = 10;
    const width = Math.floor((area.clientWidth - gap * 3) / 2);
    const height = area.clientHeight - gap * 2;
    if (width < 360 || height < 220 || left.workspace !== this.workspace || right.workspace !== this.workspace) return;
    for (const [win, x] of [[left, gap], [right, width + gap * 2]]) {
      this.cancelMotion(win);
      this.setMaximized(win, false);
      win.minimized = false;
      win.element.hidden = false;
      win.element.inert = false;
      win.element.classList.remove('opening');
      win.geometry = {x, y: gap, width, height};
      this.applyGeometry(win);
      win.element.dispatchEvent(new Event('resize'));
    }
    this.focus(left);
    this.changed();
  }
  focus(win) {if(!this.windows.includes(win))return;this.active=win;win.element.style.zIndex=++this.z;for(const w of this.windows)w.element.classList.toggle('focused',w===win);this.renderTasks();emit('focus',win);}
  minimize(win, animate = true) {
    if (win.minimized) return;
    const shouldAnimate = animate && motionEnabled() && !win.element.hidden;
    const from = shouldAnimate ? currentFrame(win) : null;
    this.cancelMotion(win);
    win.element.classList.remove('opening');
    win.minimized = true;
    win.element.inert = true;
    const wasActive = this.active === win;
    if (wasActive) this.focusNext(win);
    this.renderTasks();
    if (shouldAnimate) {
      if (wasActive) win.element.style.zIndex = ++this.z;
      this.animateWindow(win, [from ?? {transform: 'none', opacity: 1}, taskFrame(win)], 190, () => {
        win.element.hidden = true;
      });
    } else {
      win.element.hidden = true;
    }
    this.changed();
  }
  restore(win) {
    if (win.workspace !== this.workspace) this.switchWorkspace(win.workspace);
    const reveal = win.minimized;
    const from = reveal ? currentFrame(win) : null;
    if (reveal) this.cancelMotion(win);
    win.minimized = false;
    win.element.hidden = false;
    win.element.inert = false;
    this.focus(win);
    if (reveal && motionEnabled()) {
      this.animateWindow(win, [from ?? taskFrame(win), {transform: 'none', opacity: 1}], 220);
    }
    win.element.dispatchEvent(new Event('resize'));
    this.changed();
  }
  maximize(win, animate = true) {
    const before = animate && motionEnabled() && !win.element.hidden ? win.element.getBoundingClientRect() : null;
    this.cancelMotion(win);
    win.element.classList.remove('opening');
    this.setMaximized(win, !win.maximized);
    this.focus(win);
    if (before) {
      const after = win.element.getBoundingClientRect();
      const dx = before.left + before.width / 2 - (after.left + after.width / 2);
      const dy = before.top + before.height / 2 - (after.top + after.height / 2);
      const transform = `translate(${dx}px, ${dy}px) scale(${before.width / after.width}, ${before.height / after.height})`;
      this.animateWindow(win, [{transform}, {transform: 'none'}], 200);
    }
    win.element.dispatchEvent(new Event('resize'));
    this.changed();
  }
  async close(win, force=false) {if(!force&&win.beforeClose&&!await win.beforeClose())return;this.cancelMotion(win);win.abort.abort();await win.cleanup();win.element.remove();this.windows=this.windows.filter(w=>w!==win);if(this.active===win)this.focusNext(win);this.renderTasks();this.changed();}
  focusNext(except) {const next=this.windows.filter(w=>w!==except&&!w.minimized&&w.workspace===this.workspace).sort((a,b)=>Number(b.element.style.zIndex)-Number(a.element.style.zIndex))[0];this.active=null;if(next)this.focus(next);else emit('focus',null);}
  switchWorkspace(index) {this.closeTaskGroup();this.settleMotions();this.workspace=index;settings.set({workspace:index});for(const w of this.windows)w.element.hidden=w.minimized||w.workspace!==index;this.focusNext(null);this.renderTasks();this.changed();}
  cycle() {const visible=this.windows.filter(w=>w.workspace===this.workspace);if(!visible.length)return;const index=visible.indexOf(this.active);this.restore(visible[(index+1)%visible.length]);}
  bindDrag(win,handle,resize) {
    handle.addEventListener('pointerdown',event=>{
      if (event.button !== 0 || event.target.closest('button') || win.maximized || innerWidth < 640 || win.element.classList.contains('moving')) return;
      event.preventDefault();
      this.cancelMotion(win);
      this.focus(win);
      const initial = {...win.geometry};
      const {pointerId, clientX, clientY} = event;
      handle.setPointerCapture(pointerId);
      win.element.classList.remove('opening');
      win.element.classList.add('moving');

      const move = event => {
        if (event.pointerId !== pointerId) return;
        const area = $('#workarea');
        const dx = event.clientX - clientX;
        const dy = event.clientY - clientY;
        if (resize) {
          win.geometry.width = Math.min(area.clientWidth - win.geometry.x, Math.max(360, initial.width + dx));
          win.geometry.height = Math.min(area.clientHeight - win.geometry.y, Math.max(260, initial.height + dy));
        } else {
          win.geometry.x = Math.min(area.clientWidth - 80, Math.max(0, initial.x + dx));
          win.geometry.y = Math.min(area.clientHeight - 45, Math.max(0, initial.y + dy));
        }
        this.applyGeometry(win);
        win.element.dispatchEvent(new Event('resize'));
      };
      const endEvents = ['pointerup', 'pointercancel', 'lostpointercapture'];
      const stop = event => {
        if (event.pointerId !== pointerId) return;
        handle.removeEventListener('pointermove', move);
        for (const type of endEvents) handle.removeEventListener(type, stop);
        win.element.classList.remove('moving');
        this.changed();
      };
      handle.addEventListener('pointermove', move);
      for (const type of endEvents) handle.addEventListener(type, stop);
    });
  }
  closeTaskGroup(returnFocus = false) {
    if (!this.taskGroupApp) return false;
    const trigger = taskButton(this.taskGroupApp);
    this.taskGroupApp = null;
    this.taskGroupMenu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger?.focus({preventScroll: true});
    return true;
  }
  positionTaskGroup() {
    if (!this.taskGroupApp) return;
    const trigger = taskButton(this.taskGroupApp);
    const desktop = $('#desktop').getBoundingClientRect();
    const rail = $('#tasks').getBoundingClientRect();
    const bounds = trigger?.getBoundingClientRect();
    if (!bounds || bounds.right <= rail.left || bounds.left >= rail.right) {
      this.closeTaskGroup();
      return;
    }
    const menu = this.taskGroupMenu;
    const center = Math.max(rail.left, Math.min(rail.right, (bounds.left + bounds.right) / 2));
    const left = Math.max(8, Math.min(center - desktop.left - menu.offsetWidth / 2, desktop.width - menu.offsetWidth - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.bottom = `${Math.round(desktop.bottom - $('.panel').getBoundingClientRect().top + 7)}px`;
  }
  showTaskGroup(appId, edge = 'first') {
    if (this.taskGroupApp === appId) {
      this.closeTaskGroup(true);
      return;
    }
    this.closeTaskGroup();
    emit('task-group-open');
    if (!this.taskGroupMenu) {
      const menu = el('div', {id: 'task-group-menu', class: 'task-group-menu popover', role: 'menu', hidden: true});
      menu.onkeydown = event => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          this.closeTaskGroup(true);
          return;
        }
        const items = $$('[role="menuitem"]', menu);
        const index = items.indexOf(document.activeElement);
        const next = {ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length,
          Home: 0, End: items.length - 1}[event.key];
        if (next == null) return;
        event.preventDefault();
        items[next]?.focus();
      };
      $('#desktop').append(menu);
      this.taskGroupMenu = menu;
      $('#tasks').addEventListener('scroll', () => this.positionTaskGroup());
      window.addEventListener('resize', () => this.positionTaskGroup());
    }
    this.taskGroupApp = appId;
    this.renderTasks();
    const items = $$('[role="menuitem"]', this.taskGroupMenu);
    if (!this.taskGroupMenu.hidden) items[edge === 'last' ? items.length - 1 : 0]?.focus();
  }
  renderTaskGroup(windows) {
    const menu = this.taskGroupMenu;
    const focused = menu.contains(document.activeElement) ? document.activeElement.dataset.windowId : null;
    if (!windows || windows.length < 2) {
      this.closeTaskGroup(Boolean(focused));
      return;
    }
    const app = windows[0].app;
    const label = `${app.name} · ${windowCount(windows.length)}`;
    const list = el('div', {class: 'task-group-list', role: 'none'});
    for (const win of windows) {
      const title = win.title || app.name;
      const current = this.active === win && !win.minimized;
      const button = el('button', {class: 'task-group-window', title, type: 'button', role: 'menuitem', tabindex: '-1',
        'data-window-id': win.id, 'aria-current': current ? 'true' : undefined});
      const preview = el('span', {class: 'task-group-preview', 'aria-hidden': 'true'});
      preview.innerHTML = icon(app.icon);
      button.append(preview, el('span', {class: 'task-group-window-label'},
        el('strong', {}, title), el('small', {}, win.minimized ? 'Свёрнуто' : current ? 'Активное окно' : 'Открыто')));
      button.onclick = () => {
        this.closeTaskGroup();
        this.restore(win);
        win.element.focus({preventScroll: true});
      };
      list.append(button);
    }
    menu.setAttribute('aria-label', label);
    menu.replaceChildren(el('div', {class: 'task-group-heading', role: 'presentation'}, label), list);
    menu.hidden = false;
    this.positionTaskGroup();
    if (focused && !menu.hidden) {
      const item = $(`[data-window-id="${CSS.escape(focused)}"]`, list) ?? list.firstElementChild;
      item?.focus();
    }
  }
  renderTasks() {
    const target = $('#tasks');
    const groups = new Map();
    for (const win of this.windows) {
      if (win.workspace !== this.workspace) continue;
      const group = groups.get(win.app.id) ?? [];
      group.push(win);
      groups.set(win.app.id, group);
    }
    const existing = new Map([...target.children].map(button => [button.dataset.appId, button]));
    let index = 0;
    for (const [appId, windows] of groups) {
      const [win] = windows;
      const grouped = windows.length > 1;
      const button = existing.get(appId) ?? el('button', {type: 'button', 'data-app-id': appId});
      const title = grouped ? win.app.name : win.title || win.app.name;
      button.className = `task${grouped ? ' task-group' : ''}`;
      button.classList.toggle('active', windows.some(item => !item.minimized && this.active === item));
      button.title = grouped ? `${title} · ${windowCount(windows.length)}` : title;
      button.setAttribute('aria-label', button.title);
      button.innerHTML = icon(win.app.icon);
      button.append(el('span', {class: 'task-label'}, title));
      if (grouped) {
        delete button.dataset.windowId;
        button.setAttribute('aria-haspopup', 'menu');
        if (this.taskGroupMenu) button.setAttribute('aria-controls', 'task-group-menu');
        button.setAttribute('aria-expanded', String(this.taskGroupApp === appId));
        button.append(el('b', {class: 'task-group-count', 'aria-hidden': 'true'}, String(windows.length)));
        button.onclick = () => this.showTaskGroup(appId);
        button.onkeydown = event => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          if (this.taskGroupApp !== appId) this.showTaskGroup(appId, event.key === 'ArrowUp' ? 'last' : 'first');
        };
      } else {
        button.dataset.windowId = win.id;
        for (const attr of ['aria-haspopup', 'aria-controls', 'aria-expanded']) button.removeAttribute(attr);
        button.onclick = () => {
          this.closeTaskGroup();
          if (!win.minimized && this.active === win) this.minimize(win);
          else this.restore(win);
        };
        button.onkeydown = null;
      }
      if (target.children[index] !== button) target.insertBefore(button, target.children[index] ?? null);
      existing.delete(appId);
      index++;
    }
    for (const button of existing.values()) button.remove();
    if (this.taskGroupApp) this.renderTaskGroup(groups.get(this.taskGroupApp));
    $$('.workspace-switch button').forEach((b,i)=>{b.classList.toggle('active',i===this.workspace);b.classList.toggle('occupied',this.windows.some(w=>w.workspace===i));});
  }
  changed() {emit('windows',this.windows);}
  clamp() {this.settleMotions();const a=$('#workarea');for(const w of this.windows){w.geometry.width=Math.min(w.geometry.width,a.clientWidth-12);w.geometry.height=Math.min(w.geometry.height,a.clientHeight-12);w.geometry.x=Math.max(0,Math.min(w.geometry.x,a.clientWidth-w.geometry.width));w.geometry.y=Math.max(0,Math.min(w.geometry.y,a.clientHeight-w.geometry.height));this.applyGeometry(w);}}
}
export const wm=new WindowManager();
on('settings', () => { if (!motionEnabled()) wm.settleMotions(); });
on('lock', locked => { if (locked) wm.closeTaskGroup(); });
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) wm.settleMotions(); });
