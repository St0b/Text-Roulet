import {BLOCK, MATERIALS, PLACEABLE_BLOCKS} from './world.js';

// ID 100 is the charcoal already stored in earlier worlds.
export const ITEM = {charcoal: 100, ore: 101, iron: 102, coal: 103, stick: 104,
  apple: 105, pork: 106, cookedPork: 107, rottenFlesh: 108, woodSword: 109, stoneSword: 110, ironSword: 111,
  woodHoe: 112, seed: 113, wheat: 114, bread: 115};
const RESOURCES = {
  [ITEM.charcoal]: {name: 'Древесный уголь', color: '#66544d', icon: 'coal'},
  [ITEM.ore]: {name: 'Железная руда', color: '#b88b73', icon: 'ore'},
  [ITEM.iron]: {name: 'Железный слиток', color: '#c6d3cf', icon: 'ingot'},
  [ITEM.coal]: {name: 'Каменный уголь', color: '#4d5956', icon: 'coal'},
  [ITEM.stick]: {name: 'Палки', color: '#b68b62', icon: 'sticks'},
  [ITEM.apple]: {name: 'Яблоко', color: '#d36257', icon: 'food'},
  [ITEM.pork]: {name: 'Сырая свинина', color: '#e49199', icon: 'food'},
  [ITEM.cookedPork]: {name: 'Жареная свинина', color: '#b8744d', icon: 'food'},
  [ITEM.rottenFlesh]: {name: 'Гнилая плоть', color: '#89704b', icon: 'food'},
  [ITEM.woodSword]: {name: 'Деревянный меч', color: '#bf965f', icon: 'sword'},
  [ITEM.stoneSword]: {name: 'Каменный меч', color: '#919990', icon: 'sword'},
  [ITEM.ironSword]: {name: 'Железный меч', color: '#c6d3cf', icon: 'sword'},
  [ITEM.woodHoe]: {name: 'Деревянная мотыга', color: '#bf965f', icon: 'hoe'},
  [ITEM.seed]: {name: 'Семена пшеницы', color: '#84b45d', icon: 'food'},
  [ITEM.wheat]: {name: 'Пшеница', color: '#dcba72', icon: 'sticks'},
  [ITEM.bread]: {name: 'Хлеб', color: '#cf9a58', icon: 'food'},
};
export const ITEMS = [...PLACEABLE_BLOCKS, ...Object.values(ITEM)];
export const itemName = id => RESOURCES[id]?.name ?? MATERIALS[id]?.name ?? 'Пусто';
export const itemColor = id => RESOURCES[id]?.color ?? MATERIALS[id]?.color;
export const itemIcon = id => RESOURCES[id]?.icon ?? 'block';
export const isFuelCoal = id => id === ITEM.coal || id === ITEM.charcoal;
export const LEGACY_HOTBAR = [BLOCK.log, BLOCK.boards, BLOCK.dirt, BLOCK.stone,
  BLOCK.workbench, BLOCK.furnace, BLOCK.lantern, BLOCK.beacon, null];
export const HOTBAR_SIZE = 9;
