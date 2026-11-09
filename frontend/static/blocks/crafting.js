import {ITEM, isFuelCoal} from './items.js';
import {BLOCK} from './world.js';

const pick = material => [[material, material, material], [null, ITEM.stick, null], [null, ITEM.stick, null]];
const sword = material => [[material], [material], [ITEM.stick]];
export const RECIPES = [
  {id: 'boards', pattern: [[BLOCK.log]], item: BLOCK.boards, count: 4},
  {id: 'sticks', pattern: [[BLOCK.boards], [BLOCK.boards]], item: ITEM.stick, count: 4},
  {id: 'torch', pattern: [[ITEM.coal], [ITEM.stick]], item: BLOCK.torch, count: 4},
  {id: 'workbench', pattern: [[BLOCK.boards, BLOCK.boards], [BLOCK.boards, BLOCK.boards]], item: BLOCK.workbench, count: 1},
  {id: 'wood-pick', bench: true, pattern: pick(BLOCK.boards), tool: 1},
  {id: 'stone-pick', bench: true, pattern: pick(BLOCK.stone), tool: 2},
  {id: 'furnace', bench: true, pattern: [[BLOCK.stone, BLOCK.stone, BLOCK.stone],
    [BLOCK.stone, null, BLOCK.stone], [BLOCK.stone, BLOCK.stone, BLOCK.stone]], item: BLOCK.furnace, count: 1},
  {id: 'iron-pick', bench: true, pattern: pick(ITEM.iron), tool: 3},
  {id: 'wood-sword', bench: true, pattern: sword(BLOCK.boards), item: ITEM.woodSword, count: 1},
  {id: 'stone-sword', bench: true, pattern: sword(BLOCK.stone), item: ITEM.stoneSword, count: 1},
  {id: 'iron-sword', bench: true, pattern: sword(ITEM.iron), item: ITEM.ironSword, count: 1},
  {id: 'wood-hoe', bench: true, pattern: [[BLOCK.boards, BLOCK.boards], [null, ITEM.stick], [null, ITEM.stick]], item: ITEM.woodHoe, count: 1},
  {id: 'bread', bench: true, pattern: [[ITEM.wheat, ITEM.wheat, ITEM.wheat]], item: ITEM.bread, count: 1},
  {id: 'lantern', bench: true, pattern: [[ITEM.iron], [ITEM.coal]], item: BLOCK.lantern, count: 1},
  {id: 'beacon', bench: true, chapter: 4, pattern: [[ITEM.iron, ITEM.coal, ITEM.iron],
    [BLOCK.bricks, BLOCK.bricks, BLOCK.bricks], [ITEM.iron, ITEM.coal, ITEM.iron]], item: BLOCK.beacon, count: 1},
];

export function recipesFor(size) {
  return RECIPES.filter(recipe => size === 3 || !recipe.bench);
}

export function recipeLayout(recipe, size, progress) {
  const layout = Array(size ** 2).fill(null);
  let coal = progress.count(ITEM.coal);
  let charcoal = progress.count(ITEM.charcoal);
  recipe.pattern.forEach((row, y) => row.forEach((id, x) => {
    let ingredient = id;
    if (id === ITEM.coal) {
      if (coal > 0) coal--;
      else if (charcoal > 0) {
        charcoal--;
        ingredient = ITEM.charcoal;
      }
    }
    layout[y * size + x] = ingredient;
  }));
  return layout;
}

export function findRecipe(grid, size) {
  let left = size, top = size, right = -1, bottom = -1;
  grid.forEach((id, index) => {
    if (id == null) return;
    const x = index % size, y = Math.floor(index / size);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  });
  return recipesFor(size).find(({pattern}) =>
    pattern.length === bottom - top + 1 && pattern[0].length === right - left + 1
    && pattern.every((row, y) => row.every((id, x) => {
      const actual = grid[(top + y) * size + left + x];
      return id === ITEM.coal ? isFuelCoal(actual) : id === actual;
    })));
}

export function ingredients(grid) {
  const cost = new Map();
  for (const id of grid) {
    if (id != null) cost.set(id, (cost.get(id) ?? 0) + 1);
  }
  return cost;
}
