import {ask, el, emit, pickFile} from './core.js';
import {buildDocx, fontFamily} from './word-format.js';
import {createWordPages,wordPageBreak} from './word-pages.js';

const FONTS = ['Calibri','Arial','Aptos','Times New Roman','Georgia','Verdana','Courier New'];
const MAX_TEXT = 400000;
const PARAGRAPHS = 'p,h1,h2,h3,h4,li,div';
const firstParagraph = () => el('p', {}, el('br'));
const MAX_DRAFT_HTML = 16 * 1024 * 1024;
const MAX_DRAFT_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_DRAFT_ELEMENTS = 120000;
const DRAFT_IMAGE_TYPES = new Set(['image/png','image/jpeg','image/gif','image/bmp','image/webp']);
const DRAFT_TAGS = new Set([
  'p','div','span','br','wbr','h1','h2','h3','h4','blockquote','b','strong','i','em','u','s','strike','del',
  'font','sub','sup','mark','small','big','code','ul','ol','li','table','caption','colgroup','col','thead','tbody','tfoot','tr','td','th','img',
]);
const DROP_TAGS = new Set(['script','style','template','iframe','object','embed','svg','math','input','select','textarea','button']);
const DRAFT_STYLES = [
  'fontFamily','fontSize','fontWeight','fontStyle','color','backgroundColor','textDecorationLine','textDecoration',
  'textAlign','lineHeight','whiteSpace','verticalAlign','direction',
];
const damagedDraft = () => new Error('Черновик Word повреждён.');
function imageSize(value) {
  const size = Number(value);
  return Number.isInteger(size) && size > 0 && size <= 1000000 ? size : 0;
}

function draftImageMap(images) {
  if (!Array.isArray(images) || images.length > MAX_DRAFT_ELEMENTS) throw damagedDraft();
  let total = 0;
  const map = new Map();
  for (const item of images) {
    if (!item || typeof item.url !== 'string' || !item.url.startsWith('blob:') || map.has(item.url)
      || !(item.blob instanceof Blob) || !DRAFT_IMAGE_TYPES.has(item.blob.type)) throw damagedDraft();
    total += item.blob.size;
    if (total > MAX_DRAFT_IMAGE_BYTES) throw new Error('Изображения черновика Word занимают больше 64 МБ.');
    map.set(item.url,item);
  }
  return map;
}

function draftCaret(value) {
  const validPath = path => Array.isArray(path) && path.length <= 96
    && path.every(index => Number.isInteger(index) && index >= 0);
  if (Array.isArray(value) && value.length === 4 && validPath(value[0]) && validPath(value[2])
    && [value[1],value[3]].every(offset => Number.isInteger(offset) && offset >= 0)) return value;
  return null;
}

function restoreDraftPaper(draft, registerImage) {
  if (draft?.version !== 1 || typeof draft.html !== 'string' || draft.html.length > MAX_DRAFT_HTML
    || typeof draft.name !== 'string' || draft.name.length > 180) throw damagedDraft();
  const images = draftImageMap(draft.images);
  const activeImages = new Map();
  const source = document.createElement('template');
  source.innerHTML = draft.html;
  const paper = el('article', {class:'office-paper office-word'});
  let remaining = MAX_DRAFT_ELEMENTS;

  function append(node, parent, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.data)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    if (--remaining < 0 || depth > 512) throw new Error('Черновик Word содержит слишком сложное форматирование.');
    const tag = node.localName;
    if (DROP_TAGS.has(tag)) return;
    if (!DRAFT_TAGS.has(tag)) {
      for (const child of node.childNodes) append(child,parent,depth + 1);
      return;
    }
    if (tag === 'p' && node.getAttribute('data-word-page-break') === 'true') {
      parent.append(wordPageBreak());
      return;
    }
    const target = el(tag);
    if (tag === 'img') {
      const url = node.getAttribute('src');
      const image = images.get(url);
      if (!image) return;
      if (!activeImages.has(url)) activeImages.set(url, registerImage(image.blob));
      target.src = activeImages.get(url);
      target.alt = node.alt.slice(0,160);
      const width = imageSize(node.dataset.width) || imageSize(image.width);
      const height = imageSize(node.dataset.height) || imageSize(image.height);
      if (width) target.dataset.width = width;
      if (height) target.dataset.height = height;
    }
    if (tag === 'ol' && node.hasAttribute('start')) target.start = node.start;
    if (tag === 'li' && node.hasAttribute('value')) target.value = node.value;
    if (tag === 'td' || tag === 'th') {
      if (node.colSpan > 1) target.colSpan = Math.min(30,node.colSpan);
      if (node.rowSpan !== 1) target.rowSpan = Math.min(150,node.rowSpan);
    }
    const align = node.getAttribute('align');
    if (['left','right','center','justify'].includes(align)) target.setAttribute('align',align);
    if (tag === 'font') {
      const face = fontFamily(node.getAttribute('face'));
      const color = node.getAttribute('color');
      if (face) target.setAttribute('face',face);
      if (color && !/[();{}]/.test(color)) target.setAttribute('color',color.slice(0,32));
    }
    for (const property of DRAFT_STYLES) {
      const value = node.style[property];
      if (value && !/(?:url|image|var)\s*\(/i.test(value)) target.style[property] = value;
    }
    for (const child of node.childNodes) append(child,target,depth + 1);
    parent.append(target);
  }
  for (const node of source.content.childNodes) append(node,paper);
  if (paper.textContent.length > MAX_TEXT) throw damagedDraft();
  return paper;
}

function serializeCaret(root, selection) {
  if (!selection || !root.contains(selection.startContainer) || !root.contains(selection.endContainer)) return null;
  const path = node => {
    const segments = [];
    while (node !== root) {
      segments.unshift([...node.parentNode.childNodes].indexOf(node));
      node = node.parentNode;
    }
    return segments;
  };
  return [path(selection.startContainer), selection.startOffset, path(selection.endContainer), selection.endOffset];
}

function restoreCaret(root, marker) {
  const range = document.createRange();
  const resolve = path => path.reduce((node, index) => node?.childNodes[index], root);
  if (marker) {
    const [start, startOffset, end, endOffset] = marker;
    try {
      range.setStart(resolve(start), startOffset);
      range.setEnd(resolve(end), endOffset);
      return range;
    } catch { /* Native editing can remove the bookmarked node. */ }
  }
  const last = root.lastElementChild;
  const block = last?.matches('p,div,h1,h2,h3,h4') ? last
    : last?.matches('ul,ol') ? last.lastElementChild : null;
  if (block?.lastChild?.nodeName === 'BR') {
    range.setStartBefore(block.lastChild);
    range.collapse(true);
  } else {
    range.selectNodeContents(block ?? root);
    range.collapse(false);
  }
  return range;
}

function selectedTextNodes(root, range) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const result = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start < end) result.push({node,start,end});
  }
  return result;
}

async function pictureBlob(file) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error('Выберите изображение PNG, JPEG или WebP до 8 МБ.');
  }
  const image = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(image.width,image.height));
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  try { canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height); }
  finally { image.close(); }
  const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
  if (!blob) throw new Error('Не удалось подготовить изображение.');
  return {blob,width:canvas.width,height:canvas.height};
}

export function createWordEditor({name, content, imageSource, registerImage, onChange, signal, draft}) {
  const controller = new AbortController();
  signal.addEventListener('abort', () => controller.abort(), {once:true});
  const paper = draft ? restoreDraftPaper(draft,registerImage)
    : content ?? el('article', {class:'office-paper office-word'}, firstParagraph());
  paper.classList.add('word-paper');
  paper.querySelectorAll('.office-limit').forEach(notice => notice.remove());
  if (!paper.childNodes.length) paper.append(firstParagraph());
  paper.contentEditable = 'true';
  paper.spellcheck = true;
  paper.setAttribute('role','textbox');
  paper.setAttribute('aria-label','Текст документа');
  paper.setAttribute('aria-multiline','true');
  const title = el('input', {class:'word-name', type:'text', value:draft?.name ?? name, maxlength:180, 'aria-label':'Имя документа'});
  const counter = el('span', {class:'word-counter'});
  const undoButton = button('Отменить', '↶', () => restoreHistory(-1));
  const redoButton = button('Повторить', '↷', () => restoreHistory(1));
  const family = el('select', {'aria-label':'Шрифт'}, ...FONTS.map(font => el('option', {value:font}, font)));
  const size = el('input', {type:'number', min:6, max:160, step:.5, value:11, 'aria-label':'Размер шрифта, пт'});
  const paragraph = el('select', {'aria-label':'Стиль абзаца'}, ...[
    ['p','Обычный'],['h1','Заголовок 1'],['h2','Заголовок 2'],['h3','Заголовок 3'],['h4','Заголовок 4'],
  ].map(([tag,label]) => el('option', {value:tag}, label)));
  const spacing = el('select', {'aria-label':'Межстрочный интервал',title:'Межстрочный интервал'},
    el('option',{value:''},'Интервал'), ...['1','1.15','1.5','2'].map(value=>el('option',{value},value.replace('.',','))));
  const color = el('input', {type:'color', value:'#243139', 'aria-label':'Цвет текста', title:'Цвет текста'});
  const highlight = el('input', {type:'color', value:'#fff09b', 'aria-label':'Цвет выделения', title:'Цвет выделения'});
  const marks = [
    ['bold','Полужирный','Ж'],['italic','Курсив','К'],['underline','Подчёркнутый','Ч'],['strikeThrough','Зачёркнутый','З'],
  ].map(([command,label,text]) => {
    const control = button(label,text,() => toggleMark(command));
    control.dataset.wordMark = command;
    return control;
  });
  const alignment = [
    ['justifyLeft','По левому краю','M2 3h12M2 6h8M2 9h12M2 12h8'],
    ['justifyCenter','По центру','M2 3h12M4 6h8M2 9h12M4 12h8'],
    ['justifyRight','По правому краю','M2 3h12M6 6h8M2 9h12M6 12h8'],
    ['justifyFull','По ширине','M2 3h12M2 6h12M2 9h12M2 12h12'],
  ].map(([command,label,path]) => {
    const control = button(label,'',() => nativeCommand(command));
    control.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="${path}"/></svg>`;
    control.dataset.align = command;
    return control;
  });
  const ribbon = el('div', {class:'word-ribbon', role:'group', 'aria-label':'Форматирование документа'},
    group('Правка', undoButton, redoButton, button('Найти и заменить','⌕',() => toggleFind())),
    group('Шрифт', family, size, ...marks, color, highlight),
    group('Абзац', paragraph, spacing, ...alignment, button('Маркированный список','• ≡', () => nativeCommand('insertUnorderedList')),
      button('Нумерованный список','1. ≡', () => nativeCommand('insertOrderedList'))),
    group('Вставка', button('Вставить таблицу','Таблица',insertTable), button('Вставить изображение','Изображение',insertPicture),
      button('Вставить разрыв страницы','Разрыв',insertPageBreak)));
  const pages = createWordPages(paper,controller.signal);
  const find = el('input',{type:'search',maxlength:180,'aria-label':'Что найти',placeholder:'Найти в документе'});
  const replacement = el('input',{type:'text',maxlength:2000,'aria-label':'На что заменить',placeholder:'Заменить на'});
  const findStatus = el('span',{class:'word-find-status',role:'status'});
  const findPane = el('div',{class:'word-find',hidden:true},find,
    el('button',{type:'button',onclick:()=>findNext()},'Найти далее'), replacement,
    el('button',{type:'button',onclick:()=>replaceFound(false)},'Заменить'),
    el('button',{type:'button',onclick:()=>replaceFound(true)},'Заменить все'),
    findStatus, el('button',{type:'button','aria-label':'Закрыть поиск',onclick:()=>toggleFind(false)},'×'));
  const element = el('section', {class:'word-editor'},
    el('div', {class:'word-title-row'}, el('span', {}, 'WORD'), title),
    ribbon, findPane, pages.toolbar, pages.canvas,
    el('footer', {class:'statusbar word-status'}, counter, el('span', {}, 'DOCX')));

  let selected = restoreCaret(paper,draftCaret(draft?.caret));
  let typingStyle = {};
  let typingNode = null;
  let lastTypedAt = -Infinity;
  let centeredSplit;
  let history = [{html:paper.innerHTML, caret:serializeCaret(paper,selected)}];
  let index = 0;
  let saved = draft ? null : {html:paper.innerHTML, title:title.value};
  let foundIndex = -1;

  function group(label, ...controls) {
    return el('div', {class:'word-ribbon-group', role:'group', 'aria-label':label},
      el('div', {class:'word-group-controls'}, ...controls), el('span', {class:'word-group-label'}, label));
  }

  function button(label, text, action) {
    const control = el('button', {type:'button', title:label, 'aria-label':label}, text);
    control.onpointerdown = event => event.preventDefault();
    control.onclick = async () => {
      try { await action(); } catch (error) { emit('toast', {message:error.message,error:true}); }
    };
    return control;
  }

  function isDirty() { return !saved || saved.html !== paper.innerHTML || saved.title !== title.value; }

  function toggleFind(show = findPane.hidden) {
    findPane.hidden = !show;
    if (show) {
      foundIndex = -1;
      find.focus();
      find.select();
    } else focusDocument();
  }

  function search() {
    const query = find.value;
    if (!query) return [];
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
    const groups = [];
    const walker = document.createTreeWalker(paper,NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement.closest(PARAGRAPHS);
      const group = owner && paper.contains(owner) ? owner : paper;
      if (groups.at(-1)?.owner !== group) groups.push({owner:group,text:'',nodes:[]});
      const part = groups.at(-1);
      part.nodes.push({node,offset:part.text.length});
      part.text += node.data;
    }
    const matches = [];
    for (const {text,nodes} of groups) {
      let first = 0, last = 0;
      for (const match of text.matchAll(pattern)) {
        if (matches.length >= 10000) return null;
        const start = match.index;
        const end = start + match[0].length;
        while (first + 1 < nodes.length && nodes[first + 1].offset <= start) first++;
        last = Math.max(first,last);
        while (last + 1 < nodes.length && nodes[last + 1].offset < end) last++;
        const range = document.createRange();
        range.setStart(nodes[first].node,start - nodes[first].offset);
        range.setEnd(nodes[last].node,end - nodes[last].offset);
        matches.push(range);
      }
    }
    return matches;
  }

  function validMatches() {
    const matches = search();
    if (!matches) { findStatus.textContent = 'Слишком много совпадений'; return null; }
    if (!matches.length) { findStatus.textContent = 'Совпадений нет'; return null; }
    return matches;
  }

  function findNext() {
    const matches = validMatches();
    if (!matches) return;
    foundIndex = (foundIndex + 1) % matches.length;
    showRange(matches[foundIndex]);
    pages.schedule(true);
    findStatus.textContent = `${foundIndex + 1} / ${matches.length}`;
  }

  function replaceFound(all) {
    const matches = validMatches();
    if (!matches) return;
    const target = all ? matches.reverse() : [matches[Math.max(0,Math.min(foundIndex,matches.length - 1))]];
    const text = replacement.value;
    const nextLength = target.reduce((length,range)=>length + text.length - range.toString().length,paper.textContent.length);
    if (nextLength > MAX_TEXT) { findStatus.textContent = 'Результат слишком велик'; return; }
    resetTyping();
    for (const range of target) {
      range.deleteContents();
      if (text) {
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
      }
      range.collapse(true);
    }
    showRange(target.at(-1));
    foundIndex = -1;
    record();
    findStatus.textContent = `Заменено: ${target.length}`;
  }

  function update() {
    const text = paper.innerText.trim();
    const words = text ? text.split(/\s+/u).length : 0;
    counter.textContent = `${words} слов · ${text.length} знаков`;
    undoButton.disabled = index === 0;
    redoButton.disabled = index + 1 === history.length;
    pages.schedule();
    onChange();
  }

  function selectedRange() {
    const selection = getSelection();
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return paper.contains(range.startContainer) && paper.contains(range.endContainer) ? range : null;
  }

  function paragraphAt(node) {
    return (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(PARAGRAPHS);
  }

  function prepareParagraphSplit() {
    const range = selectedRange();
    if (!range) return;
    const block = paragraphAt(range.startContainer);
    if (!block || block === paper || !paper.contains(block) || block !== paragraphAt(range.endContainer)
      || block.closest('li,td,th') || block.hasAttribute('data-word-page-break')
      || !['center','-webkit-center'].includes(getComputedStyle(block).textAlign)) return;
    return {block,previous:block.previousElementSibling,next:block.nextElementSibling};
  }

  function alignNewParagraph(split) {
    const range = selectedRange();
    if (!range || !paper.contains(split.block)) return;
    const current = paragraphAt(range.startContainer);
    // A native split at the start inserts a blank before the current paragraph.
    const inserted = current === split.block ? split.block.previousElementSibling : current;
    if (!inserted || inserted === split.previous || inserted === split.next || !inserted.matches(PARAGRAPHS)
      || inserted.parentElement !== split.block.parentElement) return;
    inserted.removeAttribute('align');
    inserted.style.textAlign = 'left';
  }

  function showRange(range) {
    paper.focus({preventScroll:true});
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    selected = range.cloneRange();
  }

  function focusDocument() {
    const range = paper.contains(selected.startContainer) ? selected.cloneRange() : restoreCaret(paper);
    showRange(range);
    return range;
  }

  function updateControls() {
    const range = selectedRange();
    if (!range) return;
    selected = range.cloneRange();
    const parent = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const styles = getComputedStyle(parent);
    if (document.activeElement !== family) {
      const font = fontFamily(typingStyle.fontFamily || styles.fontFamily);
      if (font && ![...family.options].some(option => option.value === font)) family.append(el('option',{value:font},font));
      family.value = font || FONTS[0];
    }
    if (document.activeElement !== size) {
      size.value = parseFloat(typingStyle.fontSize) || Math.round(parseFloat(styles.fontSize) * 1.5) / 2 || 11;
    }
    const block = parent.closest(PARAGRAPHS);
    if (document.activeElement !== paragraph) {
      const tag = block?.tagName.toLowerCase();
      paragraph.value = /^h[1-4]$/.test(tag) ? tag : 'p';
    }
    if (document.activeElement !== spacing) spacing.value = block?.style.lineHeight || '';
    for (const mark of marks) mark.setAttribute('aria-pressed', String(markEnabled(mark.dataset.wordMark,styles)));
    const value = getComputedStyle(block || parent).textAlign;
    for (const [index, control] of alignment.entries()) {
      control.setAttribute('aria-pressed', String((value === 'start' ? 'left' : value) === ['left','center','right','justify'][index]));
    }
  }

  function record(typing = false) {
    const html = paper.innerHTML;
    const caret = serializeCaret(paper,selectedRange() ?? selected);
    if (history[index].html === html) {
      history[index].caret = caret;
      return;
    }
    const now = performance.now();
    history.splice(index + 1);
    const next = {html,caret};
    if (typing && index > 0 && now - lastTypedAt < 650) history[index] = next;
    else { history.push(next); index++; }
    lastTypedAt = typing ? now : -Infinity;
    while (history.length > 45 || (history.length > 2 && history.reduce((sum,item) => sum + item.html.length,0) > 3500000)) {
      history.shift();
      index--;
    }
    update();
    updateControls();
    pages.schedule(true);
  }

  function resetTyping() { typingStyle = {}; typingNode = null; lastTypedAt = -Infinity; }

  function restoreHistory(direction) {
    if (!history[index + direction]) return;
    resetTyping();
    index += direction;
    paper.innerHTML = history[index].html;
    showRange(restoreCaret(paper, history[index].caret));
    update();
    updateControls();
  }

  function nativeCommand(command, value) {
    resetTyping();
    focusDocument();
    document.execCommand(command, false, value ?? null);
    record();
    updateControls();
  }

  function markEnabled(command, computed) {
    if (command === 'bold' && typingStyle.fontWeight) return typingStyle.fontWeight === 'bold';
    if (command === 'italic' && typingStyle.fontStyle) return typingStyle.fontStyle === 'italic';
    if (typingStyle.textDecorationLine && (command === 'underline' || command === 'strikeThrough')) {
      return typingStyle.textDecorationLine.includes(command === 'underline' ? 'underline' : 'line-through');
    }
    if (document.queryCommandState(command)) return true;
    if (command === 'bold') return computed.fontWeight === 'bold' || Number(computed.fontWeight) >= 600;
    if (command === 'italic') return computed.fontStyle === 'italic' || computed.fontStyle === 'oblique';
    return computed.textDecorationLine.includes(command === 'underline' ? 'underline' : 'line-through');
  }

  function toggleMark(command) {
    const range = focusDocument();
    if (!range.collapsed) { nativeCommand(command); return; }
    const node = range.startContainer;
    const styles = getComputedStyle(node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
    const enabled = markEnabled(command,styles);
    if (command === 'bold') inlineStyle('fontWeight',enabled ? 'normal' : 'bold');
    else if (command === 'italic') inlineStyle('fontStyle',enabled ? 'normal' : 'italic');
    else {
      const value = command === 'underline' ? 'underline' : 'line-through';
      const other = command === 'underline' ? 'strikeThrough' : 'underline';
      const next = [!enabled && value, markEnabled(other,styles) && (other === 'underline' ? 'underline' : 'line-through')].filter(Boolean);
      inlineStyle('textDecorationLine',next.join(' ') || 'none');
    }
  }

  function inlineStyle(property, value) {
    const range = focusDocument();
    if (range.collapsed) {
      typingStyle[property] = value;
      typingNode = null;
      updateControls();
      return;
    }
    resetTyping();
    const pieces = selectedTextNodes(paper, range);
    const formatted = [];
    for (const {node,start,end} of pieces) {
      if (end < node.length) node.splitText(end);
      const text = start ? node.splitText(start) : node;
      const wrapper = el('span');
      wrapper.style[property] = value;
      text.replaceWith(wrapper);
      wrapper.append(text);
      formatted.push(text);
    }
    if (!formatted.length) return;
    const selection = document.createRange();
    selection.setStart(formatted[0],0);
    selection.setEnd(formatted.at(-1),formatted.at(-1).length);
    showRange(selection);
    record();
  }

  function insertStyled(text, range) {
    let node = typingNode;
    if (node && node === range.startContainer && range.collapsed) {
      const offset = range.startOffset;
      node.insertData(offset,text);
      range.setStart(node,offset + text.length);
    } else {
      const wrapper = el('span');
      Object.assign(wrapper.style, typingStyle);
      node = document.createTextNode(text);
      wrapper.append(node);
      range.deleteContents();
      range.insertNode(wrapper);
      range.setStart(node,node.length);
      typingNode = node;
    }
    range.collapse(true);
    showRange(range);
    record(true);
  }

  function checkLength(value) {
    if (paper.textContent.length + value.length - (selectedRange()?.toString().length ?? 0) <= MAX_TEXT) return true;
    emit('toast', {message:'Документ достиг предела в 400 000 знаков.',error:true});
    return false;
  }

  async function insertTable() {
    const answer = await ask('Вставить таблицу', {value:'3×3', message:'Укажи число строк и столбцов, например 3×4.',ok:'Вставить'});
    if (!answer || controller.signal.aborted) return;
    const dimensions = /^(\d+)\s*[×xх]\s*(\d+)$/iu.exec(answer);
    const rows = Number(dimensions?.[1]), columns = Number(dimensions?.[2]);
    if (!(rows >= 1 && rows <= 12 && columns >= 1 && columns <= 10)) throw new Error('Допустимо от 1 до 12 строк и от 1 до 10 столбцов.');
    const row = '<tr>' + '<td><p><br></p></td>'.repeat(columns) + '</tr>';
    nativeCommand('insertHTML', '<table><tbody>' + row.repeat(rows) + '</tbody></table><p><br></p>');
  }

  function insertPageBreak() {
    nativeCommand('insertHTML', wordPageBreak().outerHTML + '<p><br></p>');
  }

  async function insertPicture() {
    const [file] = await pickFile('image/png,image/jpeg,image/webp');
    if (!file || controller.signal.aborted) return;
    const {blob,width,height} = await pictureBlob(file);
    if (controller.signal.aborted) return;
    const image = el('img', {src:registerImage(blob),alt:file.name.slice(0,160),'data-width':width,'data-height':height});
    nativeCommand('insertHTML', image.outerHTML);
  }

  family.onchange = () => inlineStyle('fontFamily', family.value);
  size.onchange = () => {
    const parsed = Number(size.value);
    const normalized = Number.isFinite(parsed) && parsed > 0 ? Math.max(6, Math.min(160, Math.round(parsed * 2) / 2)) : 11;
    inlineStyle('fontSize', normalized + 'pt');
  };
  size.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); size.blur(); } };
  paragraph.onchange = () => nativeCommand('formatBlock',paragraph.value);
  spacing.onchange = () => {
    const range = focusDocument();
    const nearest = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer).closest(PARAGRAPHS);
    const targets = range.collapsed && nearest && paper.contains(nearest) ? [nearest] : [...paper.querySelectorAll(PARAGRAPHS)]
      .filter(block=>!block.querySelector(PARAGRAPHS)&&range.intersectsNode(block));
    for (const block of targets) if (!block.hasAttribute('data-word-page-break')) block.style.lineHeight=spacing.value;
    record();
  };
  color.onchange = () => inlineStyle('color',color.value);
  highlight.onchange = () => inlineStyle('backgroundColor',highlight.value);
  title.oninput = update;
  find.oninput = () => { foundIndex = -1; findStatus.textContent = ''; };
  findPane.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); toggleFind(false); }
    if (event.key === 'Enter' && event.target === find) { event.preventDefault(); findNext(); }
  };
  document.addEventListener('selectionchange', updateControls, {signal:controller.signal});
  paper.onpointerdown = resetTyping;
  paper.onkeydown = event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleFind(true);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      insertPageBreak();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ['z','y','b','i','u'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') restoreHistory(key === 'y' || event.shiftKey ? 1 : -1);
      else toggleMark({b:'bold',i:'italic',u:'underline'}[key]);
    } else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) resetTyping();
  };
  paper.onbeforeinput = event => {
    centeredSplit = event.inputType === 'insertParagraph' && !event.isComposing ? prepareParagraphSplit() : undefined;
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault();
      restoreHistory(event.inputType === 'historyUndo' ? -1 : 1);
      return;
    }
    if (!event.data) return;
    if (!checkLength(event.data)) { event.preventDefault(); return; }
    const range = selectedRange();
    if (event.inputType === 'insertText' && event.cancelable && !event.isComposing && range && Object.keys(typingStyle).length) {
      event.preventDefault();
      insertStyled(event.data,range);
    }
  };
  paper.oninput = event => {
    if (event.inputType === 'insertParagraph' && centeredSplit) alignNewParagraph(centeredSplit);
    centeredSplit = undefined;
    record(event.inputType === 'insertText' || event.inputType === 'deleteContentBackward');
  };
  paper.onpaste = event => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n');
    if (!text || !checkLength(text)) return;
    const range = focusDocument();
    if (Object.keys(typingStyle).length) insertStyled(text,range);
    else nativeCommand('insertText',text);
  };
  paper.ondrop = event => event.preventDefault();

  const filename = () => (title.value.trim().replace(/\.docx$/i,'').trim() || 'Без названия') + '.docx';
  return {
    element,
    isDirty,
    filename,
    focus() { focusDocument(); update(); updateControls(); },
    captureDraft() {
      const html = paper.innerHTML;
      if (html.length > MAX_DRAFT_HTML || paper.getElementsByTagName('*').length > MAX_DRAFT_ELEMENTS) {
        throw new Error('Черновик Word слишком велик.');
      }
      const images = new Map();
      for (const image of paper.querySelectorAll('img')) {
        const url = image.getAttribute('src');
        if (images.has(url)) continue;
        images.set(url,{url,blob:imageSource(url),width:image.naturalWidth || imageSize(image.dataset.width),
          height:image.naturalHeight || imageSize(image.dataset.height)});
      }
      const items = [...images.values()];
      draftImageMap(items);
      return {version:1,name:title.value,html,images:items,caret:serializeCaret(paper,selectedRange() ?? selected)};
    },
    async build() {
      const stamp = {html:paper.innerHTML,title:title.value};
      const snapshot = paper.cloneNode(true);
      const images = [...snapshot.querySelectorAll('img')];
      [...paper.querySelectorAll('img')].forEach((image,index) => {
        images[index].dataset.width = image.naturalWidth || image.dataset.width || 0;
        images[index].dataset.height = image.naturalHeight || image.dataset.height || 0;
      });
      const name = filename();
      return {name,stamp,data:await buildDocx(snapshot,imageSource)};
    },
    markSaved(result, filename) {
      if (title.value === result.stamp.title) title.value = filename;
      saved = {html:result.stamp.html,title:filename};
      update();
    },
    dispose() { controller.abort(); },
  };
}
