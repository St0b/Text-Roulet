import {el} from '../core.js';
import {CHAPTERS, TOOLS} from './expedition.js';
import {findRecipe, recipeLayout, recipesFor} from './crafting.js';
import {COOK_TIME, STACK_LIMIT} from './furnace.js';
import {itemColor, itemIcon, itemName} from './items.js';

const ITEM_DRAG = 'application/x-greenblocks-item';
const recipeName = recipe => recipe.tool ? TOOLS[recipe.tool] : `${itemName(recipe.item)} ×${recipe.count}`;

export function itemSwatch(id) {
  const swatch = el('span', {class: 'blocks-swatch', 'aria-hidden': 'true'});
  updateSwatch(swatch, id);
  return swatch;
}

export function updateSwatch(swatch, id) {
  swatch.style.setProperty('--block-color', itemColor(id) ?? 'transparent');
  swatch.dataset.shape = itemIcon(id);
  swatch.hidden = id == null;
}

function dragTarget(node, transfer) {
  node.ondragover = event => {
    if (event.dataTransfer.types.includes(ITEM_DRAG)) event.preventDefault();
  };
  node.ondrop = event => {
    const raw = event.dataTransfer.getData(ITEM_DRAG);
    if (!raw) return;
    event.preventDefault();
    transfer(Number(raw));
  };
}

export function createExpeditionPanel(panel, actions) {
  const q = selector => panel.querySelector(selector);
  const pack = q('.blocks-pack');
  const bar = q('.blocks-panel-bar');
  const crafting = q('.blocks-crafting');
  const furnacePanel = q('.blocks-furnace-panel');
  let world, progress, view, furnace, size, grid, picked;

  function updateJournal() {
    q('.blocks-tool').textContent = TOOLS[progress.tool];
    q('.blocks-journal').replaceChildren(...CHAPTERS.map(({name}, index) => {
      const state = index < progress.chapter ? 'done' : index === progress.chapter ? 'current' : 'later';
      return el('li', {class: state, 'aria-current': state === 'current' ? 'step' : undefined},
        el('span', {class: 'blocks-chapter-number', 'aria-hidden': 'true'}, state === 'done' ? '✓' : String(index + 1)),
        el('span', {}, name));
    }));
    q('.blocks-tasks').replaceChildren(...progress.objectives(world).map(({label, have, need}) =>
      el('li', {}, label, el('strong', {}, `${Math.min(have, need)} / ${need}`))));
    q('.blocks-journal-hint').textContent = progress.flightUnlocked
      ? 'Экспедиция завершена. Нажми F в мире, чтобы включить полёт.'
      : CHAPTERS[progress.chapter].hint;
  }

  function pick(id) {
    picked = id === picked ? null : id;
    refresh();
  }

  function slot({id, count, key, label, index, click, drop, draggable = false, pressed = false}) {
    const node = el('button', {class: 'blocks-cell', type: 'button', 'data-cell': key, 'data-item': id,
      'aria-label': label, title: label, 'aria-pressed': String(pressed), draggable: String(draggable),
      onclick: click}, itemSwatch(id), el('span', {class: 'blocks-cell-index'}, index ?? ''),
      el('b', {class: 'blocks-cell-count'}, count == null ? '' : String(count)));
    if (draggable) node.ondragstart = event => {
      event.dataTransfer.setData(ITEM_DRAG, String(id));
      event.dataTransfer.effectAllowed = 'move';
    };
    if (drop) dragTarget(node, drop);
    return node;
  }

  function toBar(id, index) {
    if (!progress.moveToHotbar(id, index)) return;
    picked = null;
    actions.changed();
    refresh();
  }

  function toPack(id) {
    const source = progress.hotbar.indexOf(id);
    if (source < 0 || id == null) return;
    progress.hotbar[source] = null;
    picked = null;
    actions.changed();
    refresh();
  }

  function renderInventory() {
    const owned = progress.backpack();
    pack.replaceChildren(...owned.map(id => slot({id, count: progress.count(id), key: `pack-${id}`,
      label: `${itemName(id)} ×${progress.count(id)}`, click: () => pick(id), pressed: picked === id, draggable: true})));
    if (!owned.length) pack.append(el('p', {}, 'В рюкзаке пусто.'));
    bar.replaceChildren(...progress.hotbar.map((id, index) => {
      const label = `${index + 1}. ${itemName(id)}${id == null ? '' : ` ×${progress.count(id)}`}`;
      const node = slot({id, count: id == null ? null : progress.count(id), key: `bar-${index}`,
        index: String(index + 1), label, pressed: id != null && picked === id, draggable: id != null,
        click: () => picked == null || id === picked ? pick(id) : toBar(picked, index),
        drop: item => toBar(item, index)});
      node.oncontextmenu = event => {
        event.preventDefault();
        toPack(id);
      };
      return node;
    }));
    q('.blocks-picked').textContent = picked == null ? 'Выбери предмет или перетащи его.'
      : `Выбрано · ${itemName(picked)} ×${progress.count(picked)}`;
  }

  function setIngredient(index, id) {
    if (id != null && !progress.count(id)) return;
    grid[index] = id;
    refresh();
  }

  function renderCrafting() {
    const found = findRecipe(grid, size);
    const reason = found ? progress.recipeStatus(found, grid) : 'Разложи ингредиенты по схеме';
    const slots = q('.blocks-craft-grid');
    slots.style.setProperty('--craft-size', size);
    slots.replaceChildren(...grid.map((id, index) => {
      const node = slot({id, key: `craft-${index}`, label: `Ячейка ${index + 1} · ${itemName(id)}`,
        click: () => setIngredient(index, id === picked ? null : picked), drop: item => setIngredient(index, item)});
      node.oncontextmenu = event => {
        event.preventDefault();
        setIngredient(index, null);
      };
      return node;
    }));
    const result = q('.blocks-craft-result');
    result.replaceChildren(...(found?.item ? [itemSwatch(found.item)] : []),
      document.createTextNode(found ? recipeName(found) : 'Результат'));
    result.disabled = Boolean(reason);
    result.onclick = () => {
      const recipe = progress.craft(grid, size);
      if (!recipe) return;
      actions.changed(`Создано · ${recipeName(recipe)}`);
      refresh();
    };
    q('.blocks-craft-status').textContent = reason || 'Нажми на результат, чтобы забрать его';
    q('.blocks-recipes').replaceChildren(...recipesFor(size).map(recipe =>
      el('button', {type: 'button', 'data-recipe': recipe.id, 'data-cell': `recipe-${recipe.id}`,
        onclick: () => {
          grid = recipeLayout(recipe, size, progress);
          refresh();
        }}, recipeName(recipe))));
  }

  function transfer(slotName, id, amount) {
    if (!furnace.load(slotName, id, amount, progress)) return;
    actions.changed();
    refresh();
  }

  function unload(slotName) {
    if (!furnace.unload(slotName, progress)) return;
    actions.changed();
    refresh();
  }

  function renderFurnace() {
    const labels = {input: 'Сырьё', fuel: 'Топливо', output: 'Результат'};
    q('.blocks-furnace-slots').replaceChildren(...Object.entries(labels).map(([name, label]) => {
      const stack = furnace[name];
      const id = stack?.id ?? null;
      const canLoad = Boolean(furnace.room(name, picked));
      const node = slot({id, count: stack?.count, key: `furnace-${name}`,
        label: `${label} · ${itemName(id)}${stack ? ` ×${stack.count}` : ''}`,
        click: () => picked != null && name !== 'output' ? transfer(name, picked, 1) : unload(name),
        drop: name === 'output' ? undefined : item => transfer(name, item, STACK_LIMIT)});
      return el('div', {class: 'blocks-furnace-slot'}, el('strong', {}, label), node,
        el('span', {class: 'blocks-furnace-item'}, itemName(id)),
        ...(name === 'output' ? [] : [
          el('button', {type: 'button', 'data-load': name, disabled: !canLoad,
            onclick: () => transfer(name, picked, STACK_LIMIT)}, 'Загрузить всё'),
        ]),
        el('button', {type: 'button', 'data-take': name, disabled: !stack, onclick: () => unload(name)}, 'Забрать'));
    }));
    updateHeat();
  }

  function updateHeat() {
    if (!furnace || panel.hidden) return;
    q('.blocks-heat').value = furnace.burnDuration ? furnace.burn / furnace.burnDuration : 0;
    q('.blocks-smelt').value = furnace.cook / COOK_TIME;
    const status = !furnace.input ? 'Загрузи железную руду, стволы или песок'
      : !furnace.smeltResult() ? 'Освободи ячейку результата'
        : !furnace.burn && !furnace.fuel ? 'Нужно топливо'
          : furnace.burn ? 'Идёт плавка' : 'Готово к розжигу';
    const label = q('.blocks-furnace-status');
    if (label.textContent !== status) label.textContent = status;
  }

  function refresh() {
    if (panel.hidden) return;
    if (!progress.count(picked)) picked = null;
    const focus = document.activeElement?.dataset.cell;
    updateJournal();
    renderInventory();
    if (view === 'furnace') renderFurnace();
    else renderCrafting();
    if (focus) panel.querySelector(`[data-cell="${focus}"]`)?.focus({preventScroll: true});
  }

  dragTarget(pack, toPack);
  q('.blocks-craft-clear').onclick = () => {
    grid.fill(null);
    refresh();
  };
  return {
    open(kind, expedition, currentWorld, index) {
      view = kind;
      progress = expedition;
      world = currentWorld;
      furnace = kind === 'furnace' ? progress.furnace(index) : null;
      size = kind === 'workbench' ? 3 : 2;
      grid = Array(size ** 2).fill(null);
      picked = null;
      q('.blocks-panel-title').textContent = {inventory: 'Инвентарь', workbench: 'Верстак', furnace: 'Печь'}[kind];
      q('.blocks-craft-title').textContent = `Крафт ${size}×${size}`;
      crafting.hidden = Boolean(furnace);
      furnacePanel.hidden = !furnace;
      panel.hidden = false;
      panel.scrollTop = 0;
      refresh();
    },
    refresh,
    updateHeat,
  };
}
