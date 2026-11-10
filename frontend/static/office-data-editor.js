import {el, icon} from './core.js';
import {OfficePackage, attribute, child, children, descendants} from './office-package.js';
import {MAX_COLUMN, MAX_ROW, parseAddress, parseFormula, sheetCalculator} from './excel-formulas.js';
import {canFormatSheet,EXCEL_FONTS,formatColumn,getCellStyle,loadWorkbookStyles,validFontChange} from './excel-styles.js';

const ROWS = 18, COLUMNS = 9;
const MAX_TEXT = 32767;
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XML_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
const CELL_TYPES = new Set(['auto','text','number','formula']);
const MAX_DRAFT_EDITS = 100000, MAX_DRAFT_TEXT = 32 * 1024 * 1024;
const validNumber = value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
const damagedDraft = () => new Error('Черновик Office повреждён.');

function columnName(column) {
  let name = '';
  while (column > 0) {
    column--;
    name = String.fromCharCode(65 + column % 26) + name;
    column = Math.floor(column / 26);
  }
  return name;
}

const address = (row, column) => columnName(column) + row;

function bounds(reference) {
  if (!reference) return null;
  const [first, last = first] = reference.split(':');
  const start = parseAddress(first), end = parseAddress(last);
  return start && end ? {start, end} : null;
}

function contains(range, row, column) {
  return range.start.row <= row && row <= range.end.row && range.start.column <= column && column <= range.end.column;
}

function makeXml(parent, name, text) {
  const prefix = parent.prefix ? `${parent.prefix}:` : '';
  const element = parent.ownerDocument.createElementNS(parent.namespaceURI, prefix + name);
  if (text != null) element.textContent = text;
  return element;
}

const decodeText = text => text.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const encodeText = text => text.replace(/_(?=x[0-9a-f]{4}_)/gi, '_x005F_');

function stringText(node) {
  if (!node) return '';
  const runs = children(node, 'r');
  return decodeText(runs.length
    ? runs.map(run => child(run, 't')?.textContent ?? '').join('')
    : child(node, 't')?.textContent ?? '');
}

function cellValue(cell, shared) {
  const raw = child(cell, 'v')?.textContent ?? '';
  const formula = child(cell, 'f');
  const type = cell?.getAttribute('t');
  const metadata = cell?.hasAttribute('cm') || cell?.hasAttribute('vm');
  if (formula) {
    const kind = formula.getAttribute('t');
    const complex = metadata || (kind && kind !== 'normal') || formula.hasAttribute('ref') || !formula.textContent;
    const cache = type === 'b' ? raw === '1' : type === 'str' ? decodeText(raw) : raw;
    return {value: formula.textContent ? '=' + formula.textContent : '', kind:'formula', complex, cache};
  }
  if (metadata) return {value: raw, kind:'other'};
  const kind = type;
  if (kind === 's') {
    const entry = /^[0-9]+$/.test(raw) ? shared[Number(raw)] : null;
    return {value: entry?.value ?? '', kind: entry?.rich ? 'rich' : 'text'};
  }
  if (kind === 'inlineStr') {
    const inline = child(cell, 'is');
    return {value: stringText(inline), kind: child(inline, 'r') ? 'rich' : 'text'};
  }
  if (kind === 'str') return {value: decodeText(raw), kind: 'text'};
  if (kind === 'b') return {value: raw === '1' ? 'ИСТИНА' : raw === '0' ? 'ЛОЖЬ' : '', kind: 'other'};
  if (kind && kind !== 'n') return {value: raw, kind: 'other'};
  return {value: raw, kind: raw ? 'number' : 'auto'};
}

function sheetRows(root) {
  const data = child(root, 'sheetData');
  if (!data) throw new Error('В листе отсутствует таблица ячеек.');
  const rows = new Map(), formulaRanges = [];
  let rowNumber = 0;
  for (const row of children(data, 'row')) {
    rowNumber = Number(row.getAttribute('r')) || rowNumber + 1;
    const cells = new Map();
    let column = 0;
    for (const cell of children(row, 'c')) {
      column = parseAddress(cell.getAttribute('r'))?.column ?? column + 1;
      cells.set(column, cell);
      const range = bounds(child(cell, 'f')?.getAttribute('ref'));
      if (range) formulaRanges.push(range);
    }
    rows.set(rowNumber, {node: row, cells});
  }
  return {data, rows, formulaRanges};
}

function sheetRestriction(root, layout) {
  const merges = children(child(root, 'mergeCells'), 'mergeCell').map(item => bounds(item.getAttribute('ref'))).filter(Boolean);
  const protection = child(root, 'sheetProtection');
  const protectedSheet = protection && !['0', 'false'].includes(protection.getAttribute('sheet'));
  return (data, row, column) => {
    if (protectedSheet) return 'На листе включена защита.';
    if (data.complex || layout.formulaRanges.some(range => contains(range, row, column))) return 'Массив или общая формула доступны для просмотра.';
    if (merges.some(range => contains(range, row, column) && (range.start.row !== row || range.start.column !== column))) return 'Выберите первую ячейку объединённого диапазона.';
    if (data.kind === 'rich') return 'В ячейке есть форматирование отдельных фрагментов текста.';
    if (data.kind === 'other') return 'Этот тип значения доступен для просмотра.';
    return '';
  };
}

function validLocation({row, column}) {
  return Number.isInteger(row) && row >= 1 && row <= MAX_ROW
    && Number.isInteger(column) && column >= 1 && column <= MAX_COLUMN;
}

function expandDimension(root, row, column) {
  const dimension = child(root, 'dimension');
  const range = bounds(dimension?.getAttribute('ref'));
  if (!range || contains(range, row, column)) return;
  const first = address(Math.min(row, range.start.row), Math.min(column, range.start.column));
  const last = address(Math.max(row, range.end.row), Math.max(column, range.end.column));
  dimension.setAttribute('ref', first === last ? first : `${first}:${last}`);
}

function nextEntry(entries, index) {
  let closest = Infinity, next;
  for (const [number, entry] of entries) {
    if (number <= index || number >= closest) continue;
    closest = number;
    next = entry;
  }
  return next;
}

function ensureCell(root, layout, row, column) {
  let entry = layout.rows.get(row);
  if (!entry) {
    const node = makeXml(layout.data, 'row');
    node.setAttribute('r', row);
    const next = nextEntry(layout.rows, row);
    layout.data.insertBefore(node, next?.node ?? null);
    entry = {node, cells: new Map()};
    layout.rows.set(row, entry);
  }
  let cell = entry.cells.get(column);
  if (!cell) {
    cell = makeXml(entry.node, 'c');
    cell.setAttribute('r', address(row, column));
    const next = nextEntry(entry.cells, column);
    entry.node.insertBefore(cell, next ?? child(entry.node, 'extLst') ?? null);
    entry.cells.set(column, cell);
    entry.node.removeAttribute('spans');
    expandDimension(root, row, column);
  }
  return cell;
}

function writeCell(root, layout, row, column, value, kind) {
  const cell=ensureCell(root,layout,row,column);
  child(cell, 'f')?.remove();
  child(cell, 'v')?.remove();
  child(cell, 'is')?.remove();
  cell.removeAttribute('t');
  const extension = child(cell, 'extLst') ?? null;
  if (kind === 'formula') {
    cell.insertBefore(makeXml(cell, 'f', value), extension);
  } else if (kind === 'number' && value) {
    cell.insertBefore(makeXml(cell, 'v', value), extension);
  } else if (value) {
    cell.setAttribute('t', 'inlineStr');
    const inline = makeXml(cell, 'is');
    const text = makeXml(inline, 't', encodeText(value));
    if (value.trim() !== value) text.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    inline.append(text);
    cell.insertBefore(inline, extension);
  }
}

function calculateSheet(layout, shared) {
  return sheetCalculator((row, column) => {
    const cell = layout.rows.get(row)?.cells.get(column);
    const data = cellValue(cell, shared);
    if (data.kind === 'formula') return data.complex ? {issue:'unsupported'} : {formula:data.value};
    const type = cell?.getAttribute('t');
    if (type === 'e') return {issue:data.value || '#VALUE!'};
    if (type === 'b') return {value:data.value === 'ИСТИНА'};
    if (data.kind === 'number') return {value:Number(data.value)};
    return {value:data.kind === 'auto' ? null : data.value};
  });
}

const displayValue = value => value === true ? 'ИСТИНА' : value === false ? 'ЛОЖЬ' : String(value ?? '');
const cachedErrors = new Set(['#DIV/0!', '#NUM!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NULL!']);

function updateFormulaCaches(root, shared) {
  const layout = sheetRows(root);
  const calculation = calculateSheet(layout, shared);
  for (const [row, {cells}] of layout.rows) {
    for (const [column, cell] of cells) {
      if (!child(cell, 'f') || cellValue(cell, shared).complex) continue;
      const {value, issue} = calculation(row, column);
      if (issue && !cachedErrors.has(issue.code)) continue;
      let type, raw;
      if (issue) { type = 'e'; raw = issue.code; }
      else if (typeof value === 'boolean') { type = 'b'; raw = value ? '1' : '0'; }
      else if (typeof value === 'string') { type = 'str'; raw = encodeText(value); }
      else raw = String(value);
      const cached = child(cell, 'v');
      if (cached?.textContent === raw && (cell.getAttribute('t') ?? undefined) === type) continue;
      if (type) cell.setAttribute('t', type);
      else cell.removeAttribute('t');
      if (cached) cached.textContent = raw;
      else cell.insertBefore(makeXml(cell, 'v', raw), child(cell, 'extLst') ?? null);
    }
  }
}

function applyFont(root,layout,styles,{row,column,format,value}) {
  if (!row) return formatColumn(root,layout,column,styles,format,value);
  const original=getCellStyle(root,layout,row,column);
  const style=styles.change(original,format,value);
  if (String(style)===original) return false;
  ensureCell(root,layout,row,column).setAttribute('s',style);
  return true;
}

function renderSheet(root, shared, styles, modified, restored) {
  const layout = sheetRows(root);
  const restrictCell = sheetRestriction(root,layout);
  const styleAllowed=styles.canChange && canFormatSheet(root);
  let row=1,column=1,selection=null,buttons=new Map(),headers=new Map(),original,inputValue,inputType;
  let calculation = calculateSheet(layout, shared);
  const value = el('textarea', {rows:'1', maxlength:MAX_TEXT, spellcheck:'false', 'aria-label':'Значение ячейки'});
  const type = el('select', {'aria-label':'Тип значения'}, el('option', {value:'auto'}, 'Авто'),
    el('option', {value:'text'}, 'Текст'), el('option', {value:'number'}, 'Число'), el('option', {value:'formula'}, 'Формула'));
  const apply = el('button', {type:'submit'}, 'Применить');
  const clear = el('button', {type:'button'}, 'Очистить');
  const current = el('strong', {class:'office-data-address'});
  const entry = el('form', {class:'office-data-entry'}, current, value, type, apply, clear);
  const info = el('p', {class:'office-data-note', role:'status'});
  const jump = el('input', {type:'text', maxlength:'10', value:'A1', 'aria-label':'Адрес ячейки', spellcheck:'false'});
  const jumpForm = el('form', {class:'office-data-jump'}, jump, el('button', {type:'submit'}, 'Перейти'));
  const family=el('select',{'aria-label':'Шрифт ячеек'},...EXCEL_FONTS.map(name=>el('option',{value:name},name)));
  const importedFont=el('option',{disabled:true,hidden:true});
  family.append(importedFont);
  const size=el('input',{type:'number',min:6,max:72,step:.1,'aria-label':'Размер шрифта ячеек, пт'});
  const bold=el('button',{type:'button','aria-label':'Полужирный шрифт ячеек','aria-pressed':false},'Ж');
  family.disabled=size.disabled=bold.disabled=!styleAllowed;
  const fontBar=el('div',{class:'office-data-font','aria-label':'Шрифт ячеек'},
    el('label',{},'Шрифт',family),el('label',{},'Размер',size),bold);
  const rowRange=el('span',{'aria-live':'polite'});
  const columnRange=el('span',{'aria-live':'polite'});
  const beforeRows=el('button',{type:'button','aria-label':'Предыдущие строки'},'↑');
  const afterRows=el('button',{type:'button','aria-label':'Следующие строки'},'↓');
  const beforeColumns=el('button',{type:'button','aria-label':'Предыдущие столбцы'},'←');
  const afterColumns=el('button',{type:'button','aria-label':'Следующие столбцы'},'→');
  const pageNav=el('nav',{class:'office-data-page-nav','aria-label':'Область листа'},
    el('div',{},beforeRows,rowRange,afterRows),el('div',{},beforeColumns,columnRange,afterColumns));
  const table = el('table', {'aria-label':'Ячейки листа'});
  const viewport = el('div', {class:'office-data-grid'}, table);
  const section=el('section',{class:'office-sheet-editor'},entry,
    el('div',{class:'office-data-tools'},fontBar,jumpForm),info,pageNav,viewport);

  const at = (r, c) => cellValue(layout.rows.get(r)?.cells.get(c), shared);
  const restriction = data => restrictCell(data,row,column);
  const columnSelected=c=>selection && c>=Math.min(selection.from,selection.to) && c<=Math.max(selection.from,selection.to);

  function setInfo(message) {
    if (info.textContent !== message) info.textContent = message;
  }

  function fieldChanged() {
    return original && !value.readOnly && (value.value !== inputValue || type.value !== inputType);
  }

  function loadField() {
    original = at(row, column);
    value.value = original.value;
    type.value = ['text', 'formula'].includes(original.kind) ? original.kind : 'auto';
    inputValue = value.value;
    inputType = type.value;
    value.removeAttribute('aria-invalid');
  }

  function commit() {
    if (!fieldChanged()) return true;
    const input = value.value.replace(XML_CONTROLS, '');
    const trimmed = input.trim();
    const number = trimmed.replace(',', '.');
    const valid = validNumber(number);
    let kind = type.value === 'number' || (type.value === 'auto' && valid) ? 'number' : 'text';
    let stored = kind === 'number' ? number : input;
    if (type.value === 'formula' && !trimmed) stored = '';
    if (trimmed && (type.value === 'formula' || (type.value === 'auto' && trimmed.startsWith('=')))) {
      try {
        stored = parseFormula(trimmed).source;
        kind = 'formula';
      } catch (error) {
        value.setAttribute('aria-invalid', 'true');
        setInfo(error.message);
        return false;
      }
    }
    if (type.value === 'number' && input && !valid) {
      value.setAttribute('aria-invalid', 'true');
      setInfo('Введите число, например 12,5, или выберите тип «Текст».');
      return false;
    }
    if (input || original.value || layout.rows.get(row)?.cells.has(column)) {
      writeCell(root, layout, row, column, stored, kind);
      calculation = calculateSheet(layout, shared);
      modified(true, kind === 'formula' || original.kind === 'formula', {row,column,value:stored,type:kind});
    }
    loadField();
    repaint();
    setInfo(formulaInfo(original) || 'Значение принято. Сохраните документ, чтобы записать файл.');
    return true;
  }

  function formulaInfo(data) {
    if (data.kind !== 'formula') return '';
    const result = calculation(row, column);
    return result.issue ? result.issue.message : `Результат формулы: ${displayValue(result.value)}`;
  }

  function paint(button, r, c) {
    const label = address(r,c);
    const data = at(r,c);
    let text = data.value;
    if (data.kind === 'formula') {
      const result = calculation(r, c);
      text = result.issue ? (result.issue.code.startsWith('#') ? result.issue.code
        : result.issue.code === 'cycle' ? 'Цикл' : displayValue(data.cache) || '—') : displayValue(result.value);
      button.dataset.formula = '';
      button.title = [data.value, result.issue?.message].filter(Boolean).join('\n').slice(0, 500);
    } else {
      delete button.dataset.formula;
      button.title = text.slice(0, 500);
    }
    button.textContent = text.slice(0, 100);
    button.setAttribute('aria-label', text ? `${label}: ${text.slice(0, 100)}` : label);
    const selected = row === r && column === c;
    button.setAttribute('aria-pressed', String(selected));
    button.toggleAttribute('data-column-selected',Boolean(columnSelected(c)));
    button.tabIndex = selected ? 0 : -1;
    const font=styles.appearance(getCellStyle(root,layout,r,c));
    button.style.fontFamily=font.family;
    button.style.fontSize=Math.max(6,Math.min(72,font.size))+'pt';
    button.style.fontWeight=font.bold?'bold':'';
  }

  function repaint() {
    for (const [reference,button] of buttons) {
      const {row,column}=parseAddress(reference);
      paint(button,row,column);
    }
    for (const [c,header] of headers) header.setAttribute('aria-pressed',String(Boolean(columnSelected(c))));
  }

  function refreshFont() {
    const currentStyle=styles.appearance(getCellStyle(root,layout,row,column));
    importedFont.textContent=importedFont.value=currentStyle.family;
    family.value=currentStyle.family;
    size.value=String(currentStyle.size);
    bold.setAttribute('aria-pressed',String(currentStyle.bold));
  }

  function formatFont(property,value) {
    if (!styleAllowed || !commit() || !validFontChange(property,value)) {
      refreshFont();
      return;
    }
    try {
      if (selection) {
        const first=Math.min(selection.from,selection.to);
        const last=Math.max(selection.from,selection.to);
        for (let c=first;c<=last;c++) {
          const edit={row:0,column:c,format:property,value};
          if (applyFont(root,layout,styles,edit)) modified(true,false,edit);
        }
      } else {
        const edit={row,column,format:property,value};
        if (applyFont(root,layout,styles,edit)) modified(true,false,edit);
      }
      repaint();
      setInfo('Шрифт изменён. Сохраните книгу, чтобы записать оформление.');
    } catch(error) { setInfo(error.message); }
    refreshFont();
  }

  function select(r, c, focus = false, mode = '') {
    if (!commit()) { value.focus(); return; }
    row = Math.max(1, Math.min(MAX_ROW, r));
    column = Math.max(1, Math.min(MAX_COLUMN, c));
    const label = address(row, column);
    selection=mode ? {from:mode==='extend' ? selection?.from??column : column,to:column} : null;
    current.textContent=selection
      ? columnName(Math.min(selection.from,selection.to))+':'+columnName(Math.max(selection.from,selection.to))
      : label;
    jump.value = label;
    loadField();
    const notice = restriction(original);
    value.readOnly = type.disabled = apply.disabled = clear.disabled = Boolean(notice);
    setInfo(selection ? 'Выделены столбцы. Настройки шрифта применяются ко всему выделению.'
      : notice || formulaInfo(original) || 'Введите значение или формулу с «=». Ctrl+End открывает конец заполненной области.');
    if (!buttons.has(label)) draw();
    else repaint();
    refreshFont();
    if (focus) buttons.get(label)?.focus();
  }

  function draw() {
    const firstRow = Math.floor((row - 1) / ROWS) * ROWS + 1;
    const firstColumn = Math.floor((column - 1) / COLUMNS) * COLUMNS + 1;
    const columns = Array.from({length:Math.min(COLUMNS, MAX_COLUMN - firstColumn + 1)}, (_, index) => firstColumn + index);
    const rows = Array.from({length:Math.min(ROWS, MAX_ROW - firstRow + 1)}, (_, index) => firstRow + index);
    const endRow=rows.at(-1),endColumn=columns.at(-1);
    rowRange.textContent=`Строки ${firstRow}–${endRow}`;
    columnRange.textContent=`Столбцы ${columnName(firstColumn)}–${columnName(endColumn)}`;
    beforeRows.disabled=firstRow===1;
    afterRows.disabled=endRow===MAX_ROW;
    beforeColumns.disabled=firstColumn===1;
    afterColumns.disabled=endColumn===MAX_COLUMN;
    buttons = new Map();
    headers = new Map();
    const head = el('thead', {}, el('tr', {}, el('th', {scope:'col'}, '№'),
      ...columns.map(c=>{
        const header=el('button',{type:'button','aria-label':'Выделить столбец '+columnName(c),
          onclick:event=>select(row,c,false,event.shiftKey?'extend':'column')},columnName(c));
        header.setAttribute('aria-pressed',String(Boolean(columnSelected(c))));
        headers.set(c,header);
        return el('th',{scope:'col'},header);
      })));
    const body = el('tbody', {}, ...rows.map(r => el('tr', {}, el('th', {scope:'row'}, String(r)),
      ...columns.map(c => {
        const label = address(r,c);
        const button = el('button', {type:'button', 'data-cell':label, onclick:() => select(r,c)});
        button.addEventListener('dblclick', () => { if (!value.readOnly) value.select(); });
        buttons.set(label, button);
        paint(button, r, c);
        return el('td', {}, button);
      }))));
    table.replaceChildren(head, body);
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }

  table.addEventListener('keydown', event => {
    if (!event.target.matches('[data-cell]')) return;
    const offsets = {ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1]};
    const offset = offsets[event.key];
    if (offset) {
      event.preventDefault();
      select(row + offset[0], column + offset[1], true);
    } else if (['PageUp','PageDown'].includes(event.key)) {
      event.preventDefault();
      const direction=event.key==='PageUp'?-1:1;
      select(row+(event.altKey?0:direction*ROWS),column+(event.altKey?direction*COLUMNS:0),true);
    } else if (event.ctrlKey && event.key==='Home') {
      event.preventDefault();
      select(1,1,true);
    } else if (event.ctrlKey && event.key==='End') {
      event.preventDefault();
      let lastRow=1,lastColumn=1;
      for (const [r,{cells}] of layout.rows) {
        lastRow=Math.max(lastRow,r);
        for (const c of cells.keys()) lastColumn=Math.max(lastColumn,c);
      }
      select(lastRow,lastColumn,true);
    } else if (event.ctrlKey && event.code==='Space') {
      event.preventDefault();
      select(row,column,true,'column');
    } else if (['Enter', 'F2'].includes(event.key) && !value.readOnly) {
      event.preventDefault();
      value.select();
    } else if (['Backspace', 'Delete'].includes(event.key) && !value.readOnly) {
      event.preventDefault();
      clear.click();
    }
  });
  beforeRows.onclick=()=>select(row-ROWS,column);
  afterRows.onclick=()=>select(row+ROWS,column);
  beforeColumns.onclick=()=>select(row,column-COLUMNS);
  afterColumns.onclick=()=>select(row,column+COLUMNS);
  family.onchange=()=>formatFont('family',family.value);
  size.onchange=()=>formatFont('size',String(Number(size.value)));
  size.onkeydown=event=>{ if (event.key==='Enter') { event.preventDefault(); size.blur(); } };
  bold.onclick=()=>formatFont('bold',bold.getAttribute('aria-pressed')==='true'?'0':'1');
  entry.addEventListener('submit', event => { event.preventDefault(); commit(); });
  value.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      const changed = fieldChanged();
      loadField();
      setInfo(restriction(original) || formulaInfo(original) || 'Ввод отменён.');
      if (changed) modified(false);
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    commit();
  });
  value.addEventListener('input', () => modified(false));
  type.addEventListener('change', () => modified(false));
  clear.addEventListener('click', () => {
    if (value.readOnly) return;
    value.value = '';
    type.value = 'auto';
    commit();
  });
  jumpForm.addEventListener('submit', event => {
    event.preventDefault();
    const location = parseAddress(jump.value.trim());
    if (!location) { setInfo('Введите адрес ячейки от A1 до XFD1048576.'); return; }
    select(location.row, location.column, true);
  });
  select(restored?.row ?? 1, restored?.column ?? 1);
  if (restored && !value.readOnly) {
    value.value = restored.value;
    type.value = restored.type;
  }
  return {element:section, commit, captureCell:() => ({row,column,value:value.value,type:type.value})};
}

function slideParts(root) {
  const list = child(child(root, 'cSld'), 'spTree');
  const bodies = descendants(list, 'txBody');
  return bodies.map(body => {
    const properties = descendants(body.parentElement, 'cNvPr')[0];
    const name = properties?.getAttribute('name')?.slice(0, 100);
    return {name, fragments:children(body, 'p').flatMap(paragraph =>
      children(paragraph, 'r').map(run => child(run, 't')).filter(Boolean))};
  }).filter(group => group.fragments.length);
}

function renderSlide(root, modified) {
  const groups = slideParts(root);
  const list = el('div', {class:'office-slide-editor'});
  let shown = 0;
  for (const [index, group] of groups.entries()) {
    const fragments = group.fragments.slice(0, 240 - shown);
    if (!fragments.length) break;
    shown += fragments.length;
    const card = el('fieldset', {class:'office-slide-text'}, el('legend', {}, group.name || `Объект ${index + 1}`));
    for (const [position, fragment] of fragments.entries()) {
      const field = el('textarea', {rows:'1', maxlength:MAX_TEXT,
        'aria-label':`${group.name || `Объект ${index + 1}`}, фрагмент ${position + 1}`});
      field.value = fragment.textContent;
      field.addEventListener('input', () => {
        const text = field.value.replace(XML_CONTROLS, '');
        if (text === fragment.textContent) return;
        fragment.textContent = text;
        modified(true,false,{group:index,fragment:position,value:text});
      });
      card.append(field);
    }
    list.append(card);
  }
  if (!shown) list.append(el('p', {class:'office-data-note'}, 'На слайде нет редактируемых текстовых фрагментов.'));
  else if (groups.reduce((total, group) => total + group.fragments.length, 0) > shown) {
    list.append(el('p', {class:'office-data-note'}, 'Показаны первые 240 текстовых фрагментов.'));
  }
  return {element:list, commit:() => true};
}

function editKey(kind,edit) {
  if (kind==='pptx') return `${edit.group}:${edit.fragment}`;
  if (edit.format) return `font:${edit.row}:${edit.column}:${edit.format}`;
  return edit.row * MAX_COLUMN + edit.column;
}

function readDraft(draft, format, pages) {
  if (draft == null) return {edits:new Map(),index:0};
  if (draft.version !== 1 || draft.kind !== format || !Array.isArray(draft.pages)
    || draft.pages.length > pages.length || !Number.isInteger(draft.index) || !pages[draft.index]) throw damagedDraft();
  const paths = new Set(pages.map(page => page.path));
  const edits = new Map();
  let totalText = 0, totalEdits = 0;
  for (const page of draft.pages) {
    if (!page || !paths.has(page.path) || edits.has(page.path) || !Array.isArray(page.edits)
      || !page.edits.length || (totalEdits += page.edits.length) > MAX_DRAFT_EDITS) throw damagedDraft();
    const records = new Map();
    for (const entry of page.edits) {
      if (!entry || typeof entry.value !== 'string' || entry.value.length > MAX_TEXT
        || entry.value.replace(XML_CONTROLS,'') !== entry.value
        || (totalText += entry.value.length) > MAX_DRAFT_TEXT) throw damagedDraft();
      let change;
      if (format === 'xlsx') {
        const {row,column,value,type,format}=entry;
        if (format!==undefined) {
          if (!validLocation({row:row===0?1:row,column}) || !validFontChange(format,value)) throw damagedDraft();
          change={row,column,value,format};
        } else {
          if (!validLocation(entry) || !CELL_TYPES.has(type) || type==='auto'
            || (type==='number' && value && !validNumber(value))) throw damagedDraft();
          if (type==='formula') {
            try { if (parseFormula(value).source!==value) throw damagedDraft(); }
            catch { throw damagedDraft(); }
          }
          change={row,column,value,type};
        }
      } else {
        const {group,fragment,value} = entry;
        if (![group,fragment].every(index => Number.isInteger(index) && index >= 0 && index < 240)) throw damagedDraft();
        change = {group,fragment,value};
      }
      const key = editKey(format,change);
      if (records.has(key)) throw damagedDraft();
      records.set(key,change);
    }
    edits.set(page.path,records);
  }
  const cell = draft.cell;
  if (cell != null && (format !== 'xlsx' || !validLocation(cell) || typeof cell.value !== 'string'
    || cell.value.length > MAX_TEXT || !CELL_TYPES.has(cell.type))) throw damagedDraft();
  return {edits,index:draft.index,cell,formulaDefinitionsChanged:draft.formulaDefinitionsChanged === true};
}

function restorePage(root, format, shared, styles, edits) {
  if (format === 'xlsx') {
    const layout = sheetRows(root);
    const restrict = sheetRestriction(root,layout);
    let formulaChanged = false;
    for (const edit of edits.values()) {
      const {row,column,value,type,format}=edit;
      if (format) {
        if (!canFormatSheet(root)) throw damagedDraft();
        applyFont(root,layout,styles,edit);
        continue;
      }
      const existing = cellValue(layout.rows.get(row)?.cells.get(column),shared);
      if (restrict(existing,row,column)) throw damagedDraft();
      if (type === 'formula' || existing.kind === 'formula') formulaChanged = true;
      writeCell(root,layout,row,column,value,type);
    }
    return formulaChanged;
  }
  let remaining = 240;
  const groups = slideParts(root).slice(0,240).map(group => {
    const fragments = group.fragments.slice(0,remaining);
    remaining -= fragments.length;
    return fragments;
  });
  for (const {group,fragment,value} of edits.values()) {
    const text = groups[group]?.[fragment];
    if (!text) throw damagedDraft();
    text.textContent = value;
  }
  return false;
}

function requestRecalculation(workbook) {
  let calculation = child(workbook, 'calcPr');
  if (!calculation) {
    const later = new Set(['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes',
      'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']);
    calculation = makeXml(workbook, 'calcPr');
    workbook.insertBefore(calculation, children(workbook).find(entry => later.has(entry.localName)) ?? null);
  }
  calculation.setAttribute('fullCalcOnLoad', '1');
}

async function removeCalculationChain(source, workbookPath, links, updates, serialize) {
  const ids = new Set(), remove = new Set();
  for (const [id, link] of links) {
    if (!link.type.endsWith('/calcChain')) continue;
    ids.add(id);
    remove.add(link.path);
  }
  if (!remove.size) return remove;
  const split = workbookPath.lastIndexOf('/') + 1;
  const relsPath = `${workbookPath.slice(0, split)}_rels/${workbookPath.slice(split)}.rels`;
  const rels = await source.xml(relsPath);
  for (const relation of children(rels, 'Relationship')) {
    if (ids.has(relation.getAttribute('Id'))) relation.remove();
  }
  if (rels) updates.set(relsPath, serialize(rels));
  const types = await source.xml('[Content_Types].xml');
  let changed = false;
  for (const part of children(types, 'Override')) {
    let name = part.getAttribute('PartName') ?? '';
    try { name = decodeURIComponent(name); } catch { continue; }
    if (!remove.has(name.replace(/^\//, ''))) continue;
    part.remove();
    changed = true;
  }
  if (changed) updates.set('[Content_Types].xml', serialize(types));
  return remove;
}

export async function createOfficeDataEditor(node, format, {onChange = () => {}, signal, draft} = {}) {
  if (!['xlsx', 'pptx'].includes(format)) throw new Error('Этот формат недоступен для редактирования.');
  const spreadsheet = format === 'xlsx';
  const source = new OfficePackage(node.data);
  if ([...source.entries.keys()].some(path => path.toLowerCase().startsWith('_xmlsignatures/'))) {
    throw new Error('Для редактирования откройте копию Office без цифровой подписи.');
  }
  const path = await source.rootPart(spreadsheet ? 'xl/workbook.xml' : 'ppt/presentation.xml');
  const [root, links] = await Promise.all([source.xml(path), source.relationships(path)]);
  signal?.throwIfAborted();
  const list = spreadsheet ? children(child(root, 'sheets'), 'sheet') : children(child(root, 'sldIdLst'), 'sldId');
  const pages = list.map((entry,index) => {
    const id = spreadsheet ? attribute(entry, 'id')
      : [...entry.attributes].find(attr => attr.localName === 'id' && attr.namespaceURI)?.value;
    const name = spreadsheet ? entry.getAttribute('name')?.slice(0,128) || `Лист ${index + 1}` : `Слайд ${index + 1}`;
    return {name, path:links.get(id)?.path};
  }).filter(page => page.path);
  if (!pages.length) throw new Error(spreadsheet ? 'В книге нет доступных листов.' : 'В презентации нет доступных слайдов.');
  const sharedPath = [...links.values()].find(part => part.type.endsWith('/sharedStrings'))?.path ?? 'xl/sharedStrings.xml';
  const shared = spreadsheet ? children(await source.xml(sharedPath), 'si').map(item =>
    ({value:stringText(item), rich:Boolean(child(item, 'r'))})) : [];
  const styles=spreadsheet ? await loadWorkbookStyles(source,path,root,links) : null;
  const recovery = readDraft(draft,format,pages);
  const edits = recovery.edits;
  const modified = new Map(), parsed = new Map(), valueParts=new Set();
  let formulaDefinitionsChanged = recovery.formulaDefinitionsChanged ?? false;
  for (const [path,changes] of edits) {
    const part = await source.xml(path);
    signal?.throwIfAborted();
    if (!part || part.localName !== (spreadsheet ? 'worksheet' : 'sld')) throw damagedDraft();
    if (restorePage(part,format,shared,styles,changes)) formulaDefinitionsChanged = true;
    if (spreadsheet && [...changes.values()].some(change=>!change.format)) valueParts.add(path);
    parsed.set(path,Promise.resolve(part));
    modified.set(path,part);
  }
  const navigation = el('select', {'aria-label':spreadsheet ? 'Лист для редактирования' : 'Слайд для редактирования'},
    ...pages.map((page,index) => el('option', {value:index}, page.name)));
  const before = el('button', {type:'button', 'aria-label':spreadsheet ? 'Предыдущий лист' : 'Предыдущий слайд'});
  const after = el('button', {type:'button', 'aria-label':spreadsheet ? 'Следующий лист' : 'Следующий слайд'});
  before.innerHTML = icon('back');
  after.innerHTML = icon('arrow');
  const view = el('div', {class:'office-data-view'});
  const header = el('div', {class:'office-data-navigation'}, before, navigation, after,
    el('span', {}, spreadsheet ? 'Ячейки, формулы и оформление' : 'Редактирование текста слайдов'));
  const element = el('div', {class:'office-data-editor'}, header, view);
  let current, index = 0, renderVersion = 0;

  async function select(position, restoredCell) {
    if (current && !current.commit()) { navigation.value = index; return; }
    const page = pages[position];
    if (!page) return;
    const version = ++renderVersion;
    index = position;
    navigation.value = index;
    before.disabled = !index;
    after.disabled = index === pages.length - 1;
    current = null;
    view.replaceChildren(el('p', {class:'office-data-note'}, 'Открываем…'));
    try {
      if (!parsed.has(page.path)) parsed.set(page.path, source.xml(page.path));
      const part = await parsed.get(page.path);
      if (signal?.aborted || version !== renderVersion) return;
      if (!part || part.localName !== (spreadsheet ? 'worksheet' : 'sld')) throw new Error('Эту часть файла не удалось открыть.');
      const changed = (savePart, formulaChanged, change) => {
        if (savePart) modified.set(page.path, part);
        if (change) {
          if (!edits.has(page.path)) edits.set(page.path,new Map());
          const records=edits.get(page.path);
          const key=editKey(format,change);
          if (spreadsheet && !change.format) valueParts.add(page.path);
          // Later font commands on cells and columns must replay in the same order.
          if (change.format) records.delete(key);
          records.set(key,change);
        }
        if (formulaChanged) formulaDefinitionsChanged = true;
        onChange();
      };
      current = spreadsheet ? renderSheet(part, shared, styles, changed, restoredCell) : renderSlide(part, changed);
      view.replaceChildren(current.element);
    } catch (error) {
      if (!signal?.aborted && version === renderVersion) view.replaceChildren(el('p', {class:'office-data-note'}, error.message));
    }
  }

  navigation.addEventListener('change', () => select(Number(navigation.value)));
  before.addEventListener('click', () => select(index - 1));
  after.addEventListener('click', () => select(index + 1));
  await select(recovery.index,recovery.cell);
  return {
    element,
    captureDraft() {
      const pages = [...edits].map(([path,records]) => ({path,edits:[...records.values()]}));
      const payload = {version:1,kind:format,pages,index,formulaDefinitionsChanged,cell:current?.captureCell?.()};
      if (pages.reduce((count,page) => count + page.edits.length,0) > MAX_DRAFT_EDITS
        || pages.reduce((sum,page) => sum + page.edits.reduce((size,edit) => size + edit.value.length,0),0) > MAX_DRAFT_TEXT) {
        throw new Error('Черновик Office слишком велик.');
      }
      return payload;
    },
    async build() {
      if (current && !current.commit()) throw new Error('Исправьте значение выбранной ячейки перед сохранением.');
      if (!modified.size) return node.data;
      const serializer = new XMLSerializer();
      const serialize = content => serializer.serializeToString(content);
      const updates = new Map();
      for (const [part, content] of modified) {
        const snapshot = valueParts.has(part) ? content.cloneNode(true) : content;
        if (valueParts.has(part)) updateFormulaCaches(snapshot, shared);
        updates.set(part, serialize(snapshot));
      }
      if (!spreadsheet) return source.replaceParts(updates);
      if (valueParts.size) {
        const workbook=root.cloneNode(true);
        requestRecalculation(workbook);
        updates.set(path,serialize(workbook));
      }
      const remove = formulaDefinitionsChanged
        ? await removeCalculationChain(source, path, links, updates, serialize)
        : undefined;
      await styles.writeParts(updates);
      return source.replaceParts(updates, remove);
    },
  };
}
