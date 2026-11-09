import {el, icon} from './core.js';
import {OfficePackage, attribute, child, children, descendants} from './office-package.js';

const ROWS = 18, COLUMNS = 9;
const MAX_ROW = 1048576, MAX_COLUMN = 16384, MAX_TEXT = 32767;
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XML_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

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

function parseAddress(value) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/i.exec(value ?? '');
  if (!match) return null;
  const column = [...match[1].toUpperCase()].reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0);
  const row = Number(match[2]);
  return column <= MAX_COLUMN && row <= MAX_ROW ? {row, column} : null;
}

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
  if (formula) return {value: raw || (formula.textContent ? '=' + formula.textContent : ''), kind: 'formula'};
  if (cell?.hasAttribute('cm') || cell?.hasAttribute('vm')) return {value: raw, kind: 'other'};
  const kind = cell?.getAttribute('t');
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

function writeCell(root, layout, row, column, value, kind) {
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
  child(cell, 'v')?.remove();
  child(cell, 'is')?.remove();
  cell.removeAttribute('t');
  const extension = child(cell, 'extLst') ?? null;
  if (kind === 'number' && value) {
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

function renderSheet(root, shared, modified) {
  const layout = sheetRows(root);
  const merges = children(child(root, 'mergeCells'), 'mergeCell').map(item => bounds(item.getAttribute('ref'))).filter(Boolean);
  const protection = child(root, 'sheetProtection');
  const protectedSheet = protection && !['0', 'false'].includes(protection.getAttribute('sheet'));
  let row = 1, column = 1, buttons = new Map(), original, inputValue, inputType;
  const value = el('textarea', {rows:'1', maxlength:MAX_TEXT, spellcheck:'false', 'aria-label':'Значение ячейки'});
  const type = el('select', {'aria-label':'Тип значения'}, el('option', {value:'auto'}, 'Авто'),
    el('option', {value:'text'}, 'Текст'), el('option', {value:'number'}, 'Число'));
  const apply = el('button', {type:'submit'}, 'Применить');
  const current = el('strong', {class:'office-data-address'});
  const entry = el('form', {class:'office-data-entry'}, current, value, type, apply);
  const info = el('p', {class:'office-data-note', role:'status'});
  const jump = el('input', {type:'text', maxlength:'10', value:'A1', 'aria-label':'Адрес ячейки', spellcheck:'false'});
  const jumpForm = el('form', {class:'office-data-jump'}, jump, el('button', {type:'submit'}, 'Перейти'));
  const table = el('table', {'aria-label':'Ячейки листа'});
  const viewport = el('div', {class:'office-data-grid'}, table);
  const section = el('section', {class:'office-sheet-editor'}, entry, jumpForm, info, viewport);

  const at = (r, c) => cellValue(layout.rows.get(r)?.cells.get(c), shared);
  function restriction(data) {
    if (protectedSheet) return 'На листе включена защита.';
    if (data.kind === 'formula' || layout.formulaRanges.some(range => contains(range, row, column))) return 'Формула доступна для просмотра.';
    if (merges.some(range => contains(range, row, column) && (range.start.row !== row || range.start.column !== column))) return 'Выберите первую ячейку объединённого диапазона.';
    if (data.kind === 'rich') return 'В ячейке есть форматирование отдельных фрагментов текста.';
    if (data.kind === 'other') return 'Этот тип значения доступен для просмотра.';
    return '';
  }

  function setInfo(message) {
    if (info.textContent !== message) info.textContent = message;
  }

  function fieldChanged() {
    return original && !value.readOnly && (value.value !== inputValue || type.value !== inputType);
  }

  function loadField() {
    original = at(row, column);
    value.value = original.value;
    type.value = ['auto', 'text', 'number'].includes(original.kind) ? original.kind : 'auto';
    inputValue = value.value;
    inputType = type.value;
    value.removeAttribute('aria-invalid');
  }

  function commit() {
    if (!fieldChanged()) return true;
    const input = value.value.replace(XML_CONTROLS, '');
    const number = input.trim().replace(',', '.');
    const valid = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(number) && Number.isFinite(Number(number));
    if (type.value === 'number' && input && !valid) {
      value.setAttribute('aria-invalid', 'true');
      setInfo('Введите число, например 12,5, или выберите тип «Текст».');
      return false;
    }
    const kind = type.value === 'number' || (type.value === 'auto' && valid) ? 'number' : 'text';
    if (input || original.value || layout.rows.get(row)?.cells.has(column)) {
      writeCell(root, layout, row, column, kind === 'number' ? number : input, kind);
      modified();
    }
    loadField();
    const button = buttons.get(address(row, column));
    if (button) paint(button, row, column);
    setInfo('Значение принято. Сохраните документ, чтобы записать файл.');
    return true;
  }

  function paint(button, r, c) {
    const label = address(r,c);
    const text = at(r,c).value;
    button.textContent = text.slice(0, 100);
    button.title = text.slice(0, 500);
    button.setAttribute('aria-label', text ? `${label}: ${text.slice(0, 100)}` : label);
    const selected = row === r && column === c;
    button.setAttribute('aria-pressed', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }

  function select(r, c, focus = false) {
    if (!commit()) { value.focus(); return; }
    const previous = buttons.get(address(row, column));
    row = Math.max(1, Math.min(MAX_ROW, r));
    column = Math.max(1, Math.min(MAX_COLUMN, c));
    const label = address(row, column);
    current.textContent = label;
    jump.value = label;
    loadField();
    const notice = restriction(original);
    value.readOnly = type.disabled = apply.disabled = Boolean(notice);
    setInfo(notice || 'Выберите ячейку, введите значение и нажмите Enter.');
    if (!buttons.has(label)) draw();
    else {
      if (previous && previous !== buttons.get(label)) {
        previous.setAttribute('aria-pressed', 'false');
        previous.tabIndex = -1;
      }
      paint(buttons.get(label), row, column);
    }
    if (focus) buttons.get(label)?.focus();
  }

  function draw() {
    const firstRow = Math.floor((row - 1) / ROWS) * ROWS + 1;
    const firstColumn = Math.floor((column - 1) / COLUMNS) * COLUMNS + 1;
    const columns = Array.from({length:Math.min(COLUMNS, MAX_COLUMN - firstColumn + 1)}, (_, index) => firstColumn + index);
    const rows = Array.from({length:Math.min(ROWS, MAX_ROW - firstRow + 1)}, (_, index) => firstRow + index);
    buttons = new Map();
    const head = el('thead', {}, el('tr', {}, el('th', {scope:'col'}, '№'),
      ...columns.map(c => el('th', {scope:'col'}, columnName(c)))));
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
    const offsets = {ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1]};
    const offset = offsets[event.key];
    if (offset) {
      event.preventDefault();
      select(row + offset[0], column + offset[1], true);
    } else if (event.key === 'Enter' && !value.readOnly) {
      event.preventDefault();
      value.select();
    }
  });
  entry.addEventListener('submit', event => { event.preventDefault(); commit(); });
  value.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    commit();
  });
  value.addEventListener('input', () => { if (fieldChanged()) modified(false); });
  type.addEventListener('change', () => { if (fieldChanged()) modified(false); });
  jumpForm.addEventListener('submit', event => {
    event.preventDefault();
    const location = parseAddress(jump.value.trim());
    if (!location) { setInfo('Введите адрес ячейки от A1 до XFD1048576.'); return; }
    select(location.row, location.column, true);
  });
  select(1, 1);
  return {element:section, commit};
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
        modified();
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

export async function createOfficeDataEditor(node, format, {onChange = () => {}, signal} = {}) {
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
  const modified = new Map(), parsed = new Map();
  const navigation = el('select', {'aria-label':spreadsheet ? 'Лист для редактирования' : 'Слайд для редактирования'},
    ...pages.map((page,index) => el('option', {value:index}, page.name)));
  const before = el('button', {type:'button', 'aria-label':spreadsheet ? 'Предыдущий лист' : 'Предыдущий слайд'});
  const after = el('button', {type:'button', 'aria-label':spreadsheet ? 'Следующий лист' : 'Следующий слайд'});
  before.innerHTML = icon('back');
  after.innerHTML = icon('arrow');
  const view = el('div', {class:'office-data-view'});
  const header = el('div', {class:'office-data-navigation'}, before, navigation, after,
    el('span', {}, spreadsheet ? 'Редактирование чисел и текста' : 'Редактирование текста слайдов'));
  const element = el('div', {class:'office-data-editor'}, header, view);
  let current, index = 0, renderVersion = 0;

  async function select(position) {
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
      const changed = (savePart = true) => {
        if (savePart) modified.set(page.path, part);
        onChange();
      };
      current = spreadsheet ? renderSheet(part, shared, changed) : renderSlide(part, changed);
      view.replaceChildren(current.element);
    } catch (error) {
      if (!signal?.aborted && version === renderVersion) view.replaceChildren(el('p', {class:'office-data-note'}, error.message));
    }
  }

  navigation.addEventListener('change', () => select(Number(navigation.value)));
  before.addEventListener('click', () => select(index - 1));
  after.addEventListener('click', () => select(index + 1));
  await select(0);
  return {
    element,
    async build() {
      if (current && !current.commit()) throw new Error('Исправьте значение выбранной ячейки перед сохранением.');
      if (!modified.size) return node.data;
      const serializer = new XMLSerializer();
      const updates = new Map([...modified].map(([part, content]) => [part, serializer.serializeToString(content)]));
      return source.replaceParts(updates);
    },
  };
}
