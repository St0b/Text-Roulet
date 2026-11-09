import {ITEM} from './items.js';
import {BLOCK} from './world.js';

export const COOK_TIME = 4000;
export const STACK_LIMIT = 64;
const SMELTING = {
  [ITEM.ore]: {id: ITEM.iron, count: 1},
  [BLOCK.log]: {id: ITEM.charcoal, count: 1},
  [BLOCK.sand]: {id: BLOCK.bricks, count: 2},
  [ITEM.pork]: {id: ITEM.cookedPork, count: 1},
};
const FUELS = {
  [ITEM.coal]: 8 * COOK_TIME, [ITEM.charcoal]: 8 * COOK_TIME,
  [BLOCK.log]: COOK_TIME, [BLOCK.boards]: COOK_TIME, [ITEM.stick]: COOK_TIME / 2,
};

export function accepts(slot, id) {
  return slot === 'input' ? Object.hasOwn(SMELTING, id) : slot === 'fuel' && Object.hasOwn(FUELS, id);
}

function restoreStack(value, allowed) {
  if (!allowed(value?.id) || !Number.isInteger(value.count) || value.count <= 0) return null;
  return {id: value.id, count: Math.min(STACK_LIMIT, value.count)};
}

const clampedTime = (value, limit) => Number.isFinite(value) ? Math.max(0, Math.min(limit, value)) : 0;

export class Furnace {
  constructor(saved) {
    this.input = restoreStack(saved?.input, id => accepts('input', id));
    this.fuel = restoreStack(saved?.fuel, id => accepts('fuel', id));
    this.output = restoreStack(saved?.output, id => Object.values(SMELTING).some(result => result.id === id));
    this.burnDuration = clampedTime(saved?.burnDuration, 8 * COOK_TIME);
    this.burn = clampedTime(saved?.burn, this.burnDuration);
    this.cook = this.input ? clampedTime(saved?.cook, COOK_TIME - 1) : 0;
  }

  room(slot, id) {
    if (!accepts(slot, id) || (this[slot] && this[slot].id !== id)) return 0;
    return STACK_LIMIT - (this[slot]?.count ?? 0);
  }

  load(slot, id, requested, inventory) {
    const count = Math.min(requested, this.room(slot, id), inventory.count(id));
    if (!Number.isInteger(count) || !inventory.withdraw(id, count)) return false;
    this[slot] = {id, count: (this[slot]?.count ?? 0) + count};
    return true;
  }

  unload(slot, inventory) {
    if (!['input', 'fuel', 'output'].includes(slot) || !this[slot]) return false;
    const {id, count} = this[slot];
    inventory.deposit(id, count);
    this[slot] = null;
    if (slot === 'input') this.cook = 0;
    return true;
  }

  smeltResult() {
    const result = SMELTING[this.input?.id];
    if (!result || (this.output && (this.output.id !== result.id || this.output.count + result.count > STACK_LIMIT))) return null;
    return result;
  }

  tick(elapsed) {
    let changed = false;
    let iron = 0;
    while (elapsed > 0) {
      const result = this.smeltResult();
      if (!result) {
        this.burn = Math.max(0, this.burn - elapsed);
        break;
      }
      if (!this.burn) {
        if (!this.fuel) break;
        this.burnDuration = this.burn = FUELS[this.fuel.id];
        if (--this.fuel.count === 0) this.fuel = null;
        changed = true;
      }
      const interval = Math.min(elapsed, this.burn, COOK_TIME - this.cook);
      this.burn -= interval;
      this.cook += interval;
      elapsed -= interval;
      if (this.cook >= COOK_TIME) {
        this.cook = 0;
        if (--this.input.count === 0) this.input = null;
        this.output = {id: result.id, count: (this.output?.count ?? 0) + result.count};
        if (result.id === ITEM.iron) iron += result.count;
        changed = true;
      }
    }
    return {changed, iron};
  }
}
