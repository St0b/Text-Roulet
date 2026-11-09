export const SIZE = 80;
export const HEIGHT = 32;
export const EYE_HEIGHT = 1.62;
export const DEFAULT_SEED = 0x47ee02;

export const BLOCK = Object.freeze({
  air: 0, grass: 1, dirt: 2, stone: 3, sand: 4, log: 5, leaves: 6,
  boards: 7, bricks: 8, water: 9, bedrock: 10,
  ore: 11, workbench: 12, furnace: 13, lantern: 14, beacon: 15, coalOre: 16, torch: 17,
  farmland: 18, wheatSeedling: 19, wheatGreen: 20, wheatRipe: 21,
});

// Texture indices are ordered as side, top, bottom.
export const MATERIALS = [
  null,
  {name: 'Дёрн', color: '#82a954', faces: [1, 0, 2]},
  {name: 'Земля', color: '#926b4b', faces: [2, 2, 2]},
  {name: 'Камень', color: '#919990', faces: [3, 3, 3]},
  {name: 'Песок', color: '#dfc590', faces: [4, 4, 4]},
  {name: 'Ствол', color: '#765843', faces: [5, 6, 6]},
  {name: 'Листва', color: '#4e8a52', faces: [7, 7, 7]},
  {name: 'Доски', color: '#bf965f', faces: [8, 8, 8]},
  {name: 'Кирпич', color: '#ad6850', faces: [9, 9, 9]},
  {name: 'Вода', color: '#539baa', faces: [10, 10, 10]},
  {name: 'Основание', color: '#484e50', faces: [11, 11, 11]},
  {name: 'Железная руда', color: '#a88772', faces: [13, 13, 13]},
  {name: 'Верстак', color: '#b78753', faces: [14, 15, 8]},
  {name: 'Печь', color: '#777a76', faces: [16, 3, 3]},
  {name: 'Фонарь', color: '#efd173', faces: [17, 17, 8]},
  {name: 'Маяк', color: '#99e3d9', faces: [18, 18, 3]},
  {name: 'Угольная руда', color: '#515753', faces: [19, 19, 19]},
  {name: 'Факел', color: '#e8af68', faces: [20, 20, 20]},
  {name: 'Грядка', color: '#805d46', faces: [2, 28, 2]},
  {name: 'Всходы пшеницы', color: '#7cac55', faces: [29, 29, 29]},
  {name: 'Растущая пшеница', color: '#7cac55', faces: [29, 29, 29]},
  {name: 'Спелая пшеница', color: '#d6ad62', faces: [30, 30, 30]},
];

export const BUILD_BLOCKS = [BLOCK.grass, BLOCK.dirt, BLOCK.stone, BLOCK.sand,
  BLOCK.log, BLOCK.leaves, BLOCK.boards, BLOCK.bricks];
export const PLACEABLE_BLOCKS = [...BUILD_BLOCKS, BLOCK.workbench, BLOCK.furnace, BLOCK.lantern, BLOCK.beacon, BLOCK.torch];
export const isWheat = id => id >= BLOCK.wheatSeedling && id <= BLOCK.wheatRipe;
const EDIT_BLOCKS = new Set([...PLACEABLE_BLOCKS, BLOCK.air, BLOCK.farmland, BLOCK.wheatSeedling, BLOCK.wheatGreen, BLOCK.wheatRipe]);

const SEA_LEVEL = 11;
const PLAYER_RADIUS = .29;
const PLAYER_HEIGHT = 1.76;
const LAYER = SIZE * SIZE;
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

export function noise(x, z, seed) {
  let n = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 144664877);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function interpolatedNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  return lerp(lerp(noise(ix, iz, seed), noise(ix + 1, iz, seed), fx),
    lerp(noise(ix, iz + 1, seed), noise(ix + 1, iz + 1, seed), fx), fz);
}

function groundHeight(x, z, seed) {
  const broad = interpolatedNoise(x / 25, z / 25, seed) - .5;
  const detail = interpolatedNoise(x / 8, z / 8, seed + 1) - .5;
  const ridge = 9 * Math.exp(-((x - 20) ** 2 / 410 + (z - 16) ** 2 / 280));
  const basin = 12 * Math.max(0, 1 - Math.hypot((x - 52) / 24, (z - 33) / 18));
  return clamp(Math.round(12 + 10 * broad + 4 * detail + ridge - basin), 4, 24);
}

export function indexOf(x, y, z) { return y * LAYER + z * SIZE + x; }
export function cellFromIndex(index) { return [index % SIZE, Math.floor(index / LAYER), Math.floor(index / SIZE) % SIZE]; }
function inWorld(x, y, z) { return x >= 0 && x < SIZE && z >= 0 && z < SIZE && y >= 0 && y < HEIGHT; }
export function isSolid(id) { return id !== BLOCK.air && id !== BLOCK.water && id !== BLOCK.torch && !isWheat(id); }

function buildTerrain(seed, expedition) {
  const blocks = new Uint8Array(LAYER * HEIGHT);
  const heights = new Uint8Array(LAYER);
  const set = (x, y, z, id) => { blocks[indexOf(x, y, z)] = id; };
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const height = groundHeight(x, z, seed);
      heights[z * SIZE + x] = height;
      const beach = height <= SEA_LEVEL + (noise(x, z, seed + 2) < .25 ? 1 : 0);
      const rock = height >= 20 && noise(x, z, seed + 6) < .52;
      set(x, 0, z, BLOCK.bedrock);
      for (let y = 1; y <= height; y++) {
        let material = BLOCK.stone;
        if (y >= height - 2 && !rock) material = beach ? BLOCK.sand : BLOCK.dirt;
        if (y === height && !rock && !beach) material = BLOCK.grass;
        if (expedition && material === BLOCK.stone && y >= 3) {
          if (y < height && noise(x >> 1, z >> 1, seed + (y >> 1) * 59) > .86
            && noise(x, z, seed + y) > .22) material = BLOCK.ore;
          else if (noise(x >> 2, z >> 2, seed + (y >> 1) * 73 + 97) > .86
            && noise(x, z, seed + y + 19) > .21) material = BLOCK.coalOre;
        }
        set(x, y, z, material);
      }
      for (let y = height + 1; y <= SEA_LEVEL; y++) set(x, y, z, BLOCK.water);
    }
  }

  // A jittered grid keeps canopies separated while still leaving open meadows.
  for (let gz = 4; gz < SIZE - 7; gz += 5) {
    for (let gx = 4; gx < SIZE - 7; gx += 5) {
      if (noise(gx, gz, seed + 7) < .63) continue;
      const x = gx + Math.floor(noise(gx, gz, seed + 8) * 3);
      const z = gz + Math.floor(noise(gx, gz, seed + 9) * 3);
      const y = heights[z * SIZE + x];
      if (blocks[indexOf(x, y, z)] !== BLOCK.grass || Math.hypot(x - 31, z - 57) < 4) continue;
      const crown = y + 4 + Math.floor(noise(x, z, seed + 10) * 2);
      for (let h = y + 1; h <= crown; h++) set(x, h, z, BLOCK.log);
      for (let dy = -1; dy <= 1; dy++) {
        const radius = dy === 1 ? 1 : 2;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
            const index = indexOf(x + dx, crown + dy, z + dz);
            if (blocks[index] === BLOCK.air) blocks[index] = BLOCK.leaves;
          }
        }
      }
    }
  }
  return blocks;
}

export class World {
  constructor(seed = DEFAULT_SEED, savedEdits = [], expedition = false) {
    this.seed = seed >>> 0;
    this.base = buildTerrain(this.seed, expedition);
    this.blocks = this.base.slice();
    this.edits = new Map();
    for (const entry of savedEdits) {
      if (!Array.isArray(entry)) continue;
      const [index, material] = entry;
      if (!Number.isInteger(index) || index < LAYER || index >= this.blocks.length) continue;
      if (!EDIT_BLOCKS.has(material)) continue;
      if (material === this.base[index]) continue;
      this.blocks[index] = material;
      this.edits.set(index, material);
    }
  }

  get(x, y, z) { return inWorld(x, y, z) ? this.blocks[indexOf(x, y, z)] : BLOCK.air; }

  set(x, y, z, material) {
    if (![x, y, z].every(Number.isInteger) || !inWorld(x, y, z) || y === 0) return false;
    if (!EDIT_BLOCKS.has(material)) return false;
    const index = indexOf(x, y, z);
    if (this.blocks[index] === material) return false;
    this.blocks[index] = material;
    if (material === this.base[index]) this.edits.delete(index);
    else this.edits.set(index, material);
    return true;
  }

  spawn() {
    for (const [x, z] of [[31, 57], [25, 51], [20, 16]]) {
      for (let y = HEIGHT - 1; y > SEA_LEVEL; y--) {
        if (isSolid(this.get(x, y, z))) return {x: x + .5, y: y + 1, z: z + .5, yaw: .6, pitch: -.16};
      }
    }
    // Start above the surface even when the central hill is submerged or edited.
    return {x: 31.5, y: SEA_LEVEL + 1, z: 57.5, yaw: .6, pitch: -.16};
  }

  collides(player, radius = PLAYER_RADIUS, height = PLAYER_HEIGHT) {
    const minX = Math.floor(player.x - radius + .0001);
    const maxX = Math.floor(player.x + radius - .0001);
    const minY = Math.floor(player.y + .0001);
    const maxY = Math.floor(player.y + height - .0001);
    const minZ = Math.floor(player.z - radius + .0001);
    const maxZ = Math.floor(player.z + radius - .0001);
    if (minX < 0 || maxX >= SIZE || minZ < 0 || maxZ >= SIZE || minY < 0) return true;
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (isSolid(this.get(x, y, z))) return true;
        }
      }
    }
    return false;
  }
}

export function direction(yaw, pitch) {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

export function raycast(world, origin, vector, reach = 7) {
  const cell = origin.map(Math.floor);
  const step = vector.map(component => component < 0 ? -1 : 1);
  const spacing = vector.map(component => component === 0 ? Infinity : Math.abs(1 / component));
  const crossing = vector.map((component, axis) => {
    if (component === 0) return Infinity;
    const boundary = cell[axis] + (step[axis] > 0 ? 1 : 0);
    return (boundary - origin[axis]) / component;
  });
  let distance = 0, adjacent = null;
  while (distance <= reach) {
    const material = world.get(...cell);
    if (material !== BLOCK.air && material !== BLOCK.water) return {cell, adjacent, material, distance};
    const axis = crossing.indexOf(Math.min(...crossing));
    distance = crossing[axis];
    adjacent = cell.slice();
    cell[axis] += step[axis];
    crossing[axis] += spacing[axis];
  }
  return null;
}

export function overlapsPlayer(player, [x, y, z]) {
  return player.x + PLAYER_RADIUS > x && player.x - PLAYER_RADIUS < x + 1
    && player.y + PLAYER_HEIGHT > y && player.y < y + 1
    && player.z + PLAYER_RADIUS > z && player.z - PLAYER_RADIUS < z + 1;
}

function moveAxis(world, player, axis, distance) {
  if (distance === 0) return false;
  const start = player[axis];
  player[axis] = start + distance;
  if (!world.collides(player)) return false;
  let safe = 0, blocked = 1;
  for (let i = 0; i < 7; i++) {
    const fraction = (safe + blocked) / 2;
    player[axis] = start + distance * fraction;
    if (world.collides(player)) blocked = fraction;
    else safe = fraction;
  }
  player[axis] = start + distance * safe;
  return true;
}

export function movePlayer(world, player, controls, dt) {
  const length = Math.hypot(controls.forward, controls.strafe) || 1;
  const swimming = world.get(Math.floor(player.x), Math.floor(player.y + .4), Math.floor(player.z)) === BLOCK.water;
  const speed = player.flying ? 9 : swimming ? 2.6 : controls.sprint ? 7 : 5;
  const forward = controls.forward / length;
  const side = controls.strafe / length;
  const dx = (Math.sin(player.yaw) * forward + Math.cos(player.yaw) * side) * speed;
  const dz = (-Math.cos(player.yaw) * forward + Math.sin(player.yaw) * side) * speed;
  const steps = Math.max(1, Math.ceil(dt * 120));
  const slice = dt / steps;
  let impact = 0;
  for (let i = 0; i < steps; i++) {
    moveAxis(world, player, 'x', dx * slice);
    moveAxis(world, player, 'z', dz * slice);
    if (player.flying) {
      player.velocity = 0;
      moveAxis(world, player, 'y', controls.vertical * 7 * slice);
      player.y = Math.min(player.y, HEIGHT + 12);
      continue;
    }
    if (swimming) player.velocity = controls.jump ? 3 : Math.max(-2, player.velocity - 7 * slice);
    else if (controls.jump && player.grounded) player.velocity = 7.3;
    player.velocity = Math.max(-24, player.velocity - (swimming ? 0 : 22) * slice);
    const blocked = moveAxis(world, player, 'y', player.velocity * slice);
    player.grounded = blocked && player.velocity < 0;
    if (blocked) {
      if (player.grounded) impact = Math.max(impact, -player.velocity);
      player.velocity = 0;
    }
  }
  return impact;
}
