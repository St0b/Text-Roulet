import {BLOCK, HEIGHT, cellFromIndex, indexOf, isSolid, isWheat} from './world.js';
import {lightAt} from './lighting.js';

const STAGE_TIME = 24;

function hydrated(world, x, y, z) {
  for (let dz = -4; dz <= 4; dz++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (world.get(x + dx, y - 1, z + dz) === BLOCK.water || world.get(x + dx, y, z + dz) === BLOCK.water) return true;
    }
  }
  return false;
}

function lit(world, x, y, z, daylight, levels) {
  if (lightAt(levels, x, y, z) >= .25) return true;
  if (daylight < .55) return false;
  for (let above = y + 1; above < HEIGHT; above++) {
    if (isSolid(world.get(x, above, z))) return false;
  }
  return true;
}

export class Farm {
  constructor(world, saved) {
    this.growth = {};
    for (const [index, id] of world.edits) {
      if (isWheat(id) && id !== BLOCK.wheatRipe) {
        const elapsed = saved?.[index];
        this.growth[index] = Number.isFinite(elapsed) ? Math.max(0, Math.min(STAGE_TIME, elapsed)) : 0;
      }
    }
  }

  toJSON() { return this.growth; }
  plant(cell) { this.growth[indexOf(...cell)] = 0; }
  remove(cell) { delete this.growth[indexOf(...cell)]; }

  tick(dt, world, daylight, levels) {
    const updates = [];
    for (const [index, elapsed] of Object.entries(this.growth)) {
      const cell = cellFromIndex(Number(index));
      const [x, y, z] = cell;
      if (!lit(world, x, y, z, daylight, levels)) continue;
      this.growth[index] = elapsed + dt * (hydrated(world, x, y, z) ? 1 : .5);
      if (this.growth[index] < STAGE_TIME) continue;
      const next = world.get(...cell) + 1;
      if (world.set(...cell, next)) updates.push(cell);
      if (next === BLOCK.wheatRipe) delete this.growth[index];
      else this.growth[index] -= STAGE_TIME;
    }
    return updates;
  }
}
