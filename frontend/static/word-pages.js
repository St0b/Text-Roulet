import {el} from './core.js';

const WIDTH = 794;
const HEIGHT = 1123;
const MARGIN = 84;
const GAP = 22;
const STRIDE = WIDTH + GAP;

export function wordPageBreak() {
  return el('p', {class:'word-page-break','data-word-page-break':'true',contenteditable:'false',
    'aria-label':'Разрыв страницы'}, el('br'));
}

export function createWordPages(paper, signal) {
  const mats = el('div', {class:'word-page-mats','aria-hidden':'true'});
  const book = el('div', {class:'word-book'}, mats, paper);
  const canvas = el('div', {class:'word-canvas'}, book);
  for (const [name,value] of [['width',WIDTH],['height',HEIGHT],['margin',MARGIN],['gap',GAP]]) {
    book.style.setProperty('--word-page-' + name,value + 'px');
  }
  const previous = el('button', {type:'button','aria-label':'Предыдущая страница',title:'Предыдущая страница'}, '‹');
  const next = el('button', {type:'button','aria-label':'Следующая страница',title:'Следующая страница'}, '›');
  const status = el('span', {class:'word-page-status'}, 'Страница 1 из 1');
  const layout = el('select', {'aria-label':'Вид страниц'},
    el('option',{value:'pages'},'Страницы A4'), el('option',{value:'spread'},'Две страницы'),
    el('option',{value:'draft'},'Черновик'));
  const toolbar = el('div',{class:'word-page-toolbar'}, previous, status, next, layout);
  let count = 1, scale = 1, fit = 1, frame = 0, follow = false;

  function firstVisible() {
    return Math.min(Math.max(0,count - fit), Math.round(canvas.scrollLeft / (STRIDE * scale)));
  }
  function updateNavigation() {
    const draft = layout.value === 'draft';
    const first = firstVisible() + 1;
    const last = Math.min(count,first + fit - 1);
    previous.disabled = draft || first === 1;
    next.disabled = draft || last === count;
    const label = draft ? 'Черновик' : first === last ? `Страница ${first} из ${count}`
      : `Страницы ${first}–${last} из ${count}`;
    if (status.textContent !== label) status.textContent = label;
  }
  function go(page) {
    canvas.scrollLeft = Math.max(0,page) * STRIDE * scale;
    updateNavigation();
  }
  function measure() {
    frame = 0;
    if (!canvas.clientWidth) return;
    const draft = layout.value === 'draft';
    canvas.classList.toggle('word-draft',draft);
    if (draft) {
      book.style.zoom = '';
      book.style.width = '';
      updateNavigation();
      follow = false;
      return;
    }
    const available = Math.max(170,canvas.clientWidth - 28);
    const spread = layout.value === 'spread';
    const oldPage = firstVisible();
    const nextScale = Math.min(1,Math.max(.24,available / (spread ? WIDTH * 2 + GAP : WIDTH)));
    const resized = Math.abs(nextScale - scale) > .0001;
    scale = nextScale;
    fit = Math.max(1,Math.floor((available + GAP * scale + 2) / (STRIDE * scale)));
    book.style.zoom = String(scale);
    const overflow = Math.max(0,paper.scrollWidth - paper.clientWidth);
    count = Math.min(2000,Math.max(1,1 + Math.ceil((overflow - 2) / STRIDE)));
    book.style.width = (count * STRIDE - GAP) + 'px';
    while (mats.children.length > count) mats.lastElementChild.remove();
    while (mats.children.length < count) {
      mats.append(el('div',{class:'word-page-mat'}, el('span',{},String(mats.children.length + 1))));
    }
    if (resized) go(oldPage);
    if (follow && document.activeElement === paper) {
      const selection = getSelection();
      if (selection?.rangeCount && paper.contains(selection.focusNode)) {
        const range = selection.getRangeAt(0).cloneRange();
        range.collapse(false);
        const rect = range.getClientRects()[0];
        const viewport = canvas.getBoundingClientRect();
        if (rect && (rect.left < viewport.left || rect.right > viewport.right)) {
          go(Math.floor((rect.left - book.getBoundingClientRect().left) / (STRIDE * scale)));
        }
        if (rect && rect.top < viewport.top + 8) canvas.scrollTop += rect.top - viewport.top - 8;
        else if (rect && rect.bottom > viewport.bottom - 8) canvas.scrollTop += rect.bottom - viewport.bottom + 8;
      }
    }
    follow = false;
    updateNavigation();
  }
  function schedule(keepCaret = false) {
    follow ||= keepCaret;
    if (!frame) frame = requestAnimationFrame(measure);
  }
  previous.onclick = () => { go(firstVisible() - 1); canvas.scrollTop = 0; };
  next.onclick = () => { go(firstVisible() + 1); canvas.scrollTop = 0; };
  layout.onchange = () => { canvas.scrollTo(0,0); schedule(); };
  canvas.addEventListener('scroll',updateNavigation,{passive:true,signal});
  paper.addEventListener('load',() => schedule(),{capture:true,signal});
  const observer = new ResizeObserver(() => schedule());
  observer.observe(canvas);
  signal.addEventListener('abort',() => { observer.disconnect(); cancelAnimationFrame(frame); },{once:true});
  schedule();
  return {canvas,toolbar,schedule};
}
