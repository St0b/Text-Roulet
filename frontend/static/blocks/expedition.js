import {BLOCK, cellFromIndex, isWheat} from './world.js';
import {HOTBAR_SIZE, ITEM, ITEMS, LEGACY_HOTBAR} from './items.js';
import {findRecipe, ingredients} from './crafting.js';
import {Furnace} from './furnace.js';

export const TOOLS = ['Руки', 'Деревянная кирка', 'Каменная кирка', 'Железная кирка'];

export const CHAPTERS = [
  {name: 'Точка опоры', hint: 'На E сделай доски, палки и верстак. Положи верстак на быструю панель, поставь и открой его ПКМ.'},
  {name: 'Каменный век', hint: 'Ищи камень на склонах или под землёй. Деревянная кирка добывает и уголь с чёрными вкраплениями.'},
  {name: 'Железное ремесло', hint: 'Каменная кирка добывает рыжую железную руду. Загрузи её и уголь в печь, затем забери слитки.'},
  {name: 'Первое поселение', hint: 'Поставь доски или кирпичи и фонари в пределах 6 блоков от одного верстака.'},
  {name: 'Сигнал экспедиции', hint: 'Собери маяк на верстаке и поставь его. Награда — свободный полёт.'},
];

export function miningRule(block, tool) {
  if (block === BLOCK.bedrock) return {message: 'Основание мира нельзя добыть'};
  if ((block === BLOCK.stone || block === BLOCK.coalOre) && tool < 1) {
    return {message: block === BLOCK.coalOre ? 'Для угля нужна деревянная кирка' : 'Для камня нужна деревянная кирка'};
  }
  if (block === BLOCK.ore && tool < 2) return {message: 'Для руды нужна каменная кирка'};
  if (block === BLOCK.ore) return {item: ITEM.ore, seconds: tool === 3 ? .53 : 1.05};
  if (block === BLOCK.coalOre) return {item: ITEM.coal, seconds: [0, .87, .6, .36][tool]};
  if (block === BLOCK.stone) return {item: block, seconds: [0, .83, .59, .34][tool]};
  if (isWheat(block)) return {item: ITEM.seed, seconds: .16};
  if (block === BLOCK.farmland) return {item: BLOCK.dirt, seconds: .35};
  return {item: block, seconds: block === BLOCK.log ? .63 : .31};
}

function stationPositions(world, wanted) {
  const positions = [];
  for (const [index, material] of world.edits) {
    if (material === wanted) positions.push(cellFromIndex(index));
  }
  return positions;
}

function settlement(world, benches) {
  const parts = [];
  for (const [index, material] of world.edits) {
    if ([BLOCK.boards, BLOCK.bricks, BLOCK.lantern].includes(material)) parts.push([cellFromIndex(index), material]);
  }
  let best = {walls: 0, lights: 0};
  let bestScore = 0;
  for (const [x, y, z] of benches) {
    let walls = 0, lights = 0;
    for (const [[px, py, pz], material] of parts) {
      if (Math.hypot(px - x, pz - z) > 6 || Math.abs(py - y) > 4) continue;
      if (material === BLOCK.lantern) lights++;
      else walls++;
    }
    const score = Math.min(walls, 12) / 12 + Math.min(lights, 2) / 2;
    if (score > bestScore) {
      best = {walls, lights};
      bestScore = score;
    }
    if (bestScore === 2) break;
  }
  return best;
}

const validCount = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const step = (label, have, need = 1) => ({label, have, need});

export class Expedition {
  constructor(saved, world, legacyMaterial) {
    this.inventory = Object.fromEntries(ITEMS.map(id => [id, validCount(saved?.inventory?.[id])]));
    this.gathered = Object.fromEntries([BLOCK.log, BLOCK.stone, ITEM.ore].map(id => [id, validCount(saved?.gathered?.[id])]));
    this.ironMade = validCount(saved?.ironMade);
    this.tool = Math.min(TOOLS.length - 1, validCount(saved?.tool));
    this.chapter = Math.min(CHAPTERS.length, validCount(saved?.chapter));
    const savedBar = Array.isArray(saved?.hotbar) ? saved.hotbar : LEGACY_HOTBAR;
    const used = new Set();
    this.hotbar = Array.from({length: HOTBAR_SIZE}, (_, index) => {
      const id = savedBar[index];
      if (!ITEMS.includes(id) || !this.count(id) || used.has(id)) return null;
      used.add(id);
      return id;
    });
    if (!Array.isArray(saved?.hotbar) && this.count(legacyMaterial) && !used.has(legacyMaterial)) {
      this.hotbar[this.hotbar.indexOf(null)] = legacyMaterial;
    }
    this.furnaces = {};
    for (const [index, material] of world.edits) {
      if (material === BLOCK.furnace && saved?.furnaces?.[index]) {
        this.furnaces[index] = new Furnace(saved.furnaces[index]);
      }
    }
  }

  get flightUnlocked() { return this.chapter === CHAPTERS.length; }
  count(id) { return this.inventory[id] ?? 0; }
  backpack() { return ITEMS.filter(id => this.count(id) && !this.hotbar.includes(id)); }

  collect(id) {
    this.deposit(id, 1);
    if (Object.hasOwn(this.gathered, id)) this.gathered[id]++;
  }

  deposit(id, count) { this.inventory[id] += count; }

  withdraw(id, count) {
    if (count <= 0 || this.count(id) < count) return false;
    this.inventory[id] -= count;
    const slot = this.hotbar.indexOf(id);
    if (slot !== -1 && !this.count(id)) this.hotbar[slot] = null;
    return true;
  }

  moveToHotbar(id, index) {
    if (!this.count(id) || !Number.isInteger(index) || index < 0 || index >= HOTBAR_SIZE) return false;
    const source = this.hotbar.indexOf(id);
    if (source === index) return false;
    if (source !== -1) this.hotbar[source] = this.hotbar[index];
    this.hotbar[index] = id;
    return true;
  }

  furnace(index) { return this.furnaces[index] ??= new Furnace(); }

  removeFurnace(index) {
    const furnace = this.furnaces[index];
    if (!furnace) return;
    for (const slot of ['input', 'fuel', 'output']) furnace.unload(slot, this);
    delete this.furnaces[index];
  }

  tickFurnaces(elapsed) {
    let changed = false;
    let active = false;
    for (const furnace of Object.values(this.furnaces)) {
      if (!furnace.burn && !(furnace.fuel && furnace.smeltResult())) continue;
      active = true;
      const result = furnace.tick(elapsed);
      changed ||= result.changed;
      this.ironMade += result.iron;
    }
    return {changed, active};
  }

  recipeStatus(recipe, grid) {
    if (this.chapter < (recipe.chapter ?? 0)) return 'Откроется после постройки поселения';
    if (recipe.tool && this.tool >= recipe.tool) return 'Инструмент уже есть';
    for (const [id, count] of ingredients(grid)) {
      if (this.count(id) < count) return 'Не хватает материалов';
    }
    return '';
  }

  craft(grid, size) {
    const recipe = findRecipe(grid, size);
    if (!recipe || this.recipeStatus(recipe, grid)) return false;
    for (const [id, count] of ingredients(grid)) this.withdraw(id, count);
    if (recipe.tool) this.tool = recipe.tool;
    else this.deposit(recipe.item, recipe.count);
    return recipe;
  }

  objectives(world) {
    switch (this.chapter) {
      case 0: return [step('Добыть стволы', this.gathered[BLOCK.log], 3),
        step('Поставить верстак', stationPositions(world, BLOCK.workbench).length),
        step('Сделать деревянную кирку', Number(this.tool >= 1))];
      case 1: return [step('Добыть камень', this.gathered[BLOCK.stone], 12),
        step('Сделать каменную кирку', Number(this.tool >= 2)),
        step('Поставить печь', stationPositions(world, BLOCK.furnace).length)];
      case 2: return [step('Добыть железную руду', this.gathered[ITEM.ore], 3),
        step('Выплавить слитки', this.ironMade, 3),
        step('Сделать железную кирку', Number(this.tool >= 3))];
      case 3: {
        const {walls, lights} = settlement(world, stationPositions(world, BLOCK.workbench));
        return [step('Блоки постройки у верстака', walls, 12), step('Фонари у того же верстака', lights, 2)];
      }
      case 4: return [step('Поставить маяк', stationPositions(world, BLOCK.beacon).length)];
      default: return [];
    }
  }

  advance(world) {
    while (!this.flightUnlocked && this.objectives(world).every(({have, need}) => have >= need)) {
      this.chapter++;
    }
  }
}
