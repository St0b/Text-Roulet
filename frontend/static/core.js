export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const uid = () => crypto.randomUUID();
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.map(child => typeof child === 'string' ? document.createTextNode(child) : child));
  return node;
}
const paths = {
  leaf:'M20 4C8 3 3 9 6 16c6 5 15 0 14-12ZM4 21 16 9',
  linux:'m5 7 4 5-4 5m7 0h7M3 3h18v18H3z',
  files:'M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11H3V7Z',
  editor:'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6',
  settings:'m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2 4h4l2-4 3-1 3-3-2-2 1-3-3-2-1-3H9Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  monitor:'M3 4h18v13H3zM8 21h8m-4-4v4M6 12l3-4 3 6 3-5 3 3',
  calc:'M5 3h14v18H5zM8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 3h1m6 0h1',
  chat:'M21 4H3v13h5l4 4v-4h9V4ZM7 9h10m-10 4h6',
  games:'M6 7h12l3 11h-4l-3-3h-4l-3 3H3L6 7Zm0 4h5m-2-2v5m6-3h1m2 2h1',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M9 10v7m6-7v7',
  home:'m2 11 10-9 10 9M5 9v12h14V9M9 21v-8h6v8',
  globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-6 6-6 12 0 18 6-6 6-12 0-18Z',
  bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4',
  lock:'M5 10h14v11H5V10Zm3 0V7a4 4 0 0 1 8 0v3m-4 4v3',
  expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  desktop:'M3 4h18v14H3zM9 22h6m-3-4v4',
  arrow:'m9 5 7 7-7 7',
  back:'m15 5-7 7 7 7',
  up:'m5 14 7-7 7 7',
  download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  plus:'M12 4v16M4 12h16',
  check:'m5 12 4 4L20 5',
  refresh:'M20 8a8 8 0 1 0 0 8m0-13v5h-5',
  play:'m7 3 14 9-14 9V3Z',
  pause:'M7 4v16M17 4v16',
  save:'M4 3h14l3 3v15H3V3h1Zm3 0v7h10V3M7 21v-7h10v7',
  info:'M12 11v6m0-10v1m9 4a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  image:'M3 3h18v18H3zM3 17l5-6 4 4 3-3 6 6M15 7h1',
  music:'M9 18V5l12-2v13M9 18a3 2 0 1 1-6 0 3 2 0 1 1 6 0Zm12-2a3 2 0 1 1-6 0 3 2 0 1 1 6 0ZM9 9l12-2',
  split:'M3 5h18v14H3zM12 5v14',
  grid:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  list:'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
  clipboard:'M9 5H5v16h14V5h-4M9 3h6v4H9zM8 12h8m-8 4h5',
};
export function icon(name, className = '') {
  return `<svg class="icon ${className}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.editor}"/></svg>`;
}
export const bytes = n => n < 1024 ? `${n} Б` : n < 1048576 ? `${(n/1024).toFixed(1)} КБ` : `${(n/1048576).toFixed(1)} МБ`;
export function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = el('a', {href:url, download:name}); a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function pickFile(accept = '', multiple = false) {
  return new Promise(resolve => {
    const input = el('input', {type:'file', accept, multiple, hidden:true});
    input.onchange = () => { resolve([...input.files]); input.remove(); };
    input.oncancel = () => { resolve([]); input.remove(); };
    document.body.append(input); input.click();
  });
}
let dialogQueue = Promise.resolve();
export function ask(title, {message = '', value, confirm = false, ok = 'Сохранить'} = {}) {
  const run = () => new Promise(resolve => {
    const dialog = $('#system-dialog'), content = $('#dialog-content');
    content.replaceChildren(el('h2', {}, title), el('p', {}, message));
    let input;
    if (!confirm) { input = el('input', {value:value ?? '', required:true, autocomplete:'off', 'aria-label':title}); content.append(input); }
    $('button[value="ok"]', dialog).textContent = ok;
    const close = () => { dialog.removeEventListener('close', close); resolve(dialog.returnValue === 'ok' ? (confirm ? true : input.value.trim()) : null); };
    dialog.addEventListener('close', close); dialog.returnValue = 'cancel'; dialog.showModal(); input?.select();
  });
  const next = dialogQueue.then(run); dialogQueue = next.catch(() => {}); return next;
}
export const events = new EventTarget();
export const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, {detail}));
export const on = (type, callback, signal) => events.addEventListener(type, e => callback(e.detail), {signal});

export const settings = (() => {
  const defaults = {name:'green', theme:'dark', wallpaper:'hills', accent:'#a5d890', animations:true, workspace:0, ram:128, profile:'buildroot', welcome:true};
  let value = {...defaults};
  try { value = {...defaults, ...JSON.parse(localStorage.getItem('greenos-settings-v2') || '{}')}; } catch { /* damaged settings fall back to defaults */ }
  value.workspace = Math.max(0, Math.min(2, Number(value.workspace) || 0));
  if (![128,256,512].includes(value.ram)) value.ram = 128;
  return {
    get: key => value[key],
    all: () => ({...value}),
    set(patch) {
      value = {...value, ...patch};
      try { localStorage.setItem('greenos-settings-v2', JSON.stringify(value)); } catch { emit('storage-error', 'Не удалось сохранить настройки браузера.'); }
      emit('settings', value);
    },
  };
})();
