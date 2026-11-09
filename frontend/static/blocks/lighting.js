import {BLOCK, HEIGHT, SIZE, cellFromIndex, indexOf, isSolid} from './world.js';

export const LIGHT_RADIUS = 12;
const EMISSION = {[BLOCK.torch]: 12, [BLOCK.lantern]: 12, [BLOCK.beacon]: 12};
const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const DAY_LENGTH = 480;
export const isNight = phase => phase >= .67 && phase < .94;

export function skyLight(phase) {
  if (phase < .08) return .6 + phase * 5;
  if (phase < .57) return 1;
  if (phase < .67) return 1 - (phase - .57) * 7.3;
  if (phase < .94) return .27;
  return .27 + (phase - .94) * 5.5;
}

export function blockLights(world) {
  const sources = [...world.edits].filter(([, block]) => EMISSION[block]);
  if (!sources.length) return null;
  const levels = new Uint8Array(world.blocks.length);
  const queue = [];
  for (const [index, block] of sources) {
    levels[index] = EMISSION[block];
    queue.push(index);
  }
  for (let i = 0; i < queue.length; i++) {
    const index = queue[i];
    const light = levels[index] - 1;
    if (light === 0) continue;
    const [x, y, z] = cellFromIndex(index);
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= SIZE || ny < 0 || ny >= HEIGHT || nz < 0 || nz >= SIZE) continue;
      const next = indexOf(nx, ny, nz);
      if (levels[next] >= light || isSolid(world.blocks[next])) continue;
      levels[next] = light;
      queue.push(next);
    }
  }
  return levels;
}

export function lightAt(levels, x, y, z) {
  if (!levels || x < 0 || x >= SIZE || y < 0 || y >= HEIGHT || z < 0 || z >= SIZE) return 0;
  return levels[indexOf(x, y, z)] / LIGHT_RADIUS;
}
