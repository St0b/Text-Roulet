import {el, emit, icon, on, settings} from './core.js';
import {fs} from './storage.js';

const defaults = [
  {kind: 'home', id: 'home', col: 0, row: 0},
  {kind: 'app', id: 'linux', col: 0, row: 1},
  {kind: 'app', id: 'editor', col: 0, row: 2},
  {kind: 'trash', id: 'trash', col: 0, row: 3},
];
const keyOf = item => `${item.kind}:${item.id}`;
const cellKey = (col, row) => `${col},${row}`;
const validCell = (col, row) => Number.isInteger(col) && col >= 0 && Number.isInteger(row) && row >= 0;

export function desktopShortcuts(root, apps, openApp, openFile) {
  const outline = el('div', {class: 'shortcut-drop', 'aria-hidden': 'true', hidden: true});
  let columns, rows, width, height, positions;
  let dragging, renderPending = false;

  function entries() {
    const saved = settings.get('shortcuts');
    const seen = new Set();
    return (Array.isArray(saved) ? saved : defaults).filter(item => {
      if (!item || typeof item.id !== 'string' || !validCell(item.col, item.row) || seen.has(keyOf(item))) return false;
      if (!['home', 'trash', 'app', 'file'].includes(item.kind) || (item.kind === 'app' && !apps.has(item.id))) return false;
      seen.add(keyOf(item));
      return true;
    });
  }

  function firstEmpty(used) {
    for (let index = 0; ; index++) {
      const inView = index < rows * columns;
      const col = inView ? Math.floor(index / rows) : index % columns;
      const row = inView ? index % rows : Math.floor(index / columns);
      if (!used.has(cellKey(col, row))) return {col, row};
    }
  }

  function layout(list) {
    const used = new Set();
    const placed = new Map();
    const availableRows = Math.max(rows, Math.ceil(list.length / columns));
    for (const item of list) {
      const {col, row} = item;
      const cell = cellKey(col, row);
      if (col >= columns || row >= availableRows || used.has(cell)) continue;
      used.add(cell);
      placed.set(keyOf(item), {col, row});
    }
    for (const item of list) {
      if (placed.has(keyOf(item))) continue;
      const {col, row} = firstEmpty(used);
      used.add(cellKey(col, row));
      placed.set(keyOf(item), {col, row});
    }
    return placed;
  }

  function update(list) {
    settings.set({shortcuts: list});
    render();
  }

  function remove(key) {
    update(entries().filter(item => keyOf(item) !== key));
  }

  function move(key, col, row) {
    const from = positions.get(key);
    if (!from || (from.col === col && from.row === row)) return;
    const occupied = [...positions].find(([, cell]) => cell.col === col && cell.row === row)?.[0];
    update(entries().map(item => {
      const id = keyOf(item);
      return id === key ? {...item, col, row} : {...item, ...(id === occupied ? from : positions.get(id))};
    }));
    root.querySelector(`[data-shortcut="${CSS.escape(key)}"]`)?.focus({preventScroll: true});
  }

  function shortcutTarget(item) {
    if (item.kind === 'home') return {label: 'Домашняя папка', symbol: 'files', app: 'files',
      open: () => openApp('files', {folder: 'home'})};
    if (item.kind === 'trash') return {label: 'Корзина', symbol: 'trash', app: 'trash',
      open: () => openApp('files', {folder: 'trash'})};
    if (item.kind === 'app') {
      const app = apps.get(item.id);
      return {label: app.name, symbol: app.icon, app: app.id, open: () => openApp(app.id)};
    }
    const node = fs.get(item.id);
    const unavailable = !node || fs.isTrashed(node);
    return {label: node?.name ?? item.name ?? 'Недоступный ярлык',
      symbol: node?.type === 'dir' ? 'files' : 'editor', app: 'file', unavailable,
      open: () => {
        if (!unavailable) openFile(node);
        else emit('toast', {message: 'Объект ярлыка недоступен.', error: true});
      }};
  }

  function cellFromPointer(event) {
    const box = root.getBoundingClientRect();
    const col = Math.floor((event.clientX - box.left + root.scrollLeft) / width);
    const row = Math.floor((event.clientY - box.top + root.scrollTop) / height);
    const limit = Math.max(rows - 1, ...[...positions.values()].map(position => position.row));
    return event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom
      && col >= 0 && col < columns && row >= 0 && row <= limit ? {col, row} : null;
  }

  function render() {
    if (dragging) {
      renderPending = true;
      return;
    }
    renderPending = false;
    const style = getComputedStyle(root);
    width = parseFloat(style.getPropertyValue('--shortcut-width')) || 92;
    height = parseFloat(style.getPropertyValue('--shortcut-height')) || 96;
    columns = Math.max(1, Math.floor(root.clientWidth / width));
    rows = Math.max(1, Math.floor(root.clientHeight / height));
    const list = entries();
    positions = layout(list);
    root.replaceChildren(outline, ...list.map(item => {
      const key = keyOf(item);
      const target = shortcutTarget(item);
      const button = el('button', {class: 'desktop-icon', 'data-app': target.app, 'data-shortcut': key,
        'aria-label': target.label, title: target.unavailable ? `${target.label} · недоступен` : target.label, type: 'button'});
      const tile = el('span', {class: 'app-icon'});
      tile.innerHTML = icon(target.symbol);
      button.append(tile, el('span', {class: 'shortcut-label'}, target.label));
      const {col, row} = positions.get(key);
      button.style.gridColumn = col + 1;
      button.style.gridRow = row + 1;
      button.dataset.col = col;
      button.dataset.row = row;
      let suppressClick = false;
      button.onclick = event => { if (!suppressClick || event.detail === 0) target.open(); };
      button.onkeydown = event => {
        if (event.key !== 'Delete') return;
        event.preventDefault();
        remove(key);
      };
      button.oncontextmenu = event => {
        event.preventDefault();
        emit('context', {x: event.clientX, y: event.clientY, items: [
          {label: 'Открыть', action: target.open},
          {label: 'Убрать ярлык', action: () => remove(key)},
        ]});
      };
      button.onpointerdown = event => {
        if (event.button !== 0 || !event.isPrimary) return;
        suppressClick = false;
        dragging = {id: event.pointerId, x: event.clientX, y: event.clientY, button, moved: false};
        button.setPointerCapture(event.pointerId);
      };
      button.onpointermove = event => {
        if (dragging?.button !== button || dragging.id !== event.pointerId) return;
        const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
        if (!dragging.moved) {
          if (Math.hypot(dx, dy) < 7) return;
          dragging.moved = suppressClick = true;
          button.classList.add('shortcut-moving');
        }
        button.style.transform = `translate(${dx}px, ${dy}px)`;
        const cell = cellFromPointer(event);
        outline.hidden = !cell;
        if (cell) {
          outline.style.gridColumn = cell.col + 1;
          outline.style.gridRow = cell.row + 1;
        }
      };
      function finish(event, commit) {
        if (dragging?.button !== button || dragging.id !== event.pointerId) return;
        const cell = commit && dragging.moved ? cellFromPointer(event) : null;
        dragging = null;
        button.style.transform = '';
        button.classList.remove('shortcut-moving');
        outline.hidden = true;
        if (cell) move(key, cell.col, cell.row);
        if (renderPending) render();
      }
      button.onpointerup = event => finish(event, true);
      button.onpointercancel = button.onlostpointercapture = event => finish(event, false);
      return button;
    }));
  }

  function add(kind, id) {
    const list = entries();
    if (list.some(item => item.id === id && item.kind === kind)) {
      emit('toast', {message: 'Этот ярлык уже есть на рабочем столе.'});
      return;
    }
    const node = kind === 'file' ? fs.get(id) : null;
    if (kind === 'file' && (!node || fs.isTrashed(node))) return;
    if (kind === 'app' && !apps.has(id)) return;
    const used = new Set([...positions.values()].map(cell => cellKey(cell.col, cell.row)));
    // Store the displayed grid so a newly added shortcut cannot displace one after a resize.
    const placed = list.map(item => ({...item, ...positions.get(keyOf(item))}));
    update([...placed, {kind, id, ...firstEmpty(used), ...(node ? {name: node.name} : {})}]);
    emit('toast', {message: 'Ярлык добавлен на рабочий стол.'});
  }

  new ResizeObserver(render).observe(root);
  on('files', render);
  render();
  return {add, render, arrange() {
    const used = new Set();
    update(entries().map(item => {
      const cell = firstEmpty(used);
      used.add(cellKey(cell.col, cell.row));
      return {...item, ...cell};
    }));
  }};
}
