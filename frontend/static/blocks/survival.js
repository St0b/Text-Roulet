import {BLOCK, EYE_HEIGHT, HEIGHT, SIZE, direction, indexOf, isSolid, raycast} from './world.js';
import {ITEM, ITEMS} from './items.js';
import {DAY_LENGTH, isNight, lightAt} from './lighting.js';

export const MAX_VITAL = 20;
export const MAX_BREATH = 10;
export const MOBS = {
  pig: {name: 'Свинья', radius: .44, height: .95, health: 10, speed: 1.05, drop: ITEM.pork, count: 2},
  zombie: {name: 'Зомби', radius: .34, height: 1.86, health: 20, speed: 1.65, drop: ITEM.rottenFlesh, count: 1},
};
const FOOD = {[ITEM.apple]: 4, [ITEM.pork]: 3, [ITEM.cookedPork]: 8, [ITEM.rottenFlesh]: 4, [ITEM.bread]: 5};
const WEAPON_DAMAGE = {[ITEM.woodSword]: 5, [ITEM.stoneSword]: 6, [ITEM.ironSword]: 7};
const SURFACE = new Set([BLOCK.grass, BLOCK.dirt, BLOCK.stone, BLOCK.sand, BLOCK.coalOre, BLOCK.ore]);
export const isFood = item => Object.hasOwn(FOOD, item);
const clamp = (value, max, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
const validPosition = object => object && [object.x, object.y, object.z].every(Number.isFinite)
  && object.x >= 0 && object.x < SIZE && object.z >= 0 && object.z < SIZE && object.y >= 0 && object.y <= HEIGHT + 12;

function restoreMobs(saved) {
  if (!Array.isArray(saved)) return [];
  return saved.slice(0, 20).filter(mob => validPosition(mob) && Object.hasOwn(MOBS, mob.kind) && mob.health > 0)
    .map(({kind, x, y, z, health, yaw}) => ({
      kind, x, y, z, health: clamp(health, MOBS[kind].health, MOBS[kind].health),
      yaw: Number.isFinite(yaw) ? yaw : 0, wander: 0, hurt: 0, velocity: 0, grounded: false,
    }));
}

function restoreCaches(saved) {
  if (!Array.isArray(saved)) return [];
  const caches = [];
  for (const cache of saved) {
    if (!validPosition(cache)) continue;
    const items = ITEMS.filter(id => Number.isSafeInteger(cache.items?.[id]) && cache.items[id] > 0)
      .map(id => [id, cache.items[id]]);
    if (items.length) caches.push({x: cache.x, y: cache.y, z: cache.z, items: Object.fromEntries(items)});
  }
  return caches;
}

function rayBox(origin, vector, min, max, limit) {
  let enter = 0, exit = limit;
  for (let axis = 0; axis < 3; axis++) {
    const component = vector[axis];
    if (Math.abs(component) < .00001) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return Infinity;
      continue;
    }
    const a = (min[axis] - origin[axis]) / component;
    const b = (max[axis] - origin[axis]) / component;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return Infinity;
  }
  return enter;
}

function canSee(world, mob, player, height) {
  const origin = [mob.x, mob.y + height * .83, mob.z];
  const vector = [player.x - origin[0], player.y + 1 - origin[1], player.z - origin[2]];
  const distance = Math.hypot(...vector);
  return distance < .05 || !raycast(world, origin, vector.map(component => component / distance), distance);
}

function openSky(world, mob, height) {
  const x = Math.floor(mob.x), z = Math.floor(mob.z);
  for (let y = Math.floor(mob.y + height); y < HEIGHT; y++) {
    if (isSolid(world.get(x, y, z))) return false;
  }
  return true;
}

function moveMob(world, mob, kind, speed, dt) {
  const collides = () => world.collides(mob, kind.radius, kind.height);
  for (const [axis, delta] of [['x', Math.sin(mob.yaw) * speed * dt], ['z', -Math.cos(mob.yaw) * speed * dt]]) {
    const from = mob[axis];
    mob[axis] += delta;
    if (!collides()) continue;
    const y = mob.y;
    if (mob.grounded) {
      mob.y += 1;
      if (!collides()) continue;
    }
    mob.y = y;
    mob[axis] = from;
  }
  const y = mob.y;
  mob.velocity = Math.max(-15, mob.velocity - 16 * dt);
  mob.y += mob.velocity * dt;
  mob.grounded = collides();
  if (mob.grounded) {
    // Resolve to the last safe vertical position, including fractional coordinates after a step.
    let safe = y, blocked = mob.y;
    for (let i = 0; i < 6; i++) {
      mob.y = (safe + blocked) / 2;
      if (collides()) blocked = mob.y;
      else safe = mob.y;
    }
    mob.y = safe;
    mob.velocity = 0;
  }
}

function findSpawn(world, player, kind, levels) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 6 + Math.random() * 12;
    const x = Math.floor(player.x + Math.sin(angle) * radius);
    const z = Math.floor(player.z + Math.cos(angle) * radius);
    if (x < 1 || z < 1 || x >= SIZE - 1 || z >= SIZE - 1) continue;
    for (let y = HEIGHT - 2; y >= 1; y--) {
      const surface = world.get(x, y, z);
      if (surface === BLOCK.water) break;
      if (!isSolid(surface)) continue;
      if (!SURFACE.has(surface) || world.base[indexOf(x, y, z)] !== surface) break;
      if (kind === 'zombie' && lightAt(levels, x, y + 1, z) >= .33) break;
      return {kind, x: x + .5, y: y + 1, z: z + .5, health: MOBS[kind].health, yaw: angle,
        wander: 0, hurt: 0, velocity: 0, grounded: true};
    }
  }
  return null;
}

export class Survival {
  constructor(saved) {
    this.health = clamp(saved?.health, MAX_VITAL, MAX_VITAL);
    this.food = clamp(saved?.food, MAX_VITAL, MAX_VITAL);
    this.breath = clamp(saved?.breath, MAX_BREATH, MAX_BREATH);
    this.time = clamp(saved?.time, Number.MAX_SAFE_INTEGER, DAY_LENGTH * .12);
    this.difficulty = saved?.difficulty === 'peaceful' ? 'peaceful' : 'normal';
    this.exhaustion = clamp(saved?.exhaustion, 4, 0);
    this.sickness = clamp(saved?.sickness, 12, 0);
    this.mobs = restoreMobs(saved?.mobs);
    this.caches = restoreCaches(saved?.caches);
    this.cooldown = 0;
    this.invulnerable = 0;
    this.regen = 0;
    this.spawnIn = 2;
    this.breathHit = 0;
  }

  toJSON() {
    const {health, food, breath, time, difficulty, exhaustion, sickness, mobs, caches} = this;
    return {health, food, breath, time, difficulty, exhaustion, sickness, caches,
      mobs: mobs.map(({kind, x, y, z, health, yaw}) => ({kind, x, y, z, health, yaw}))};
  }

  get phase() { return (this.time % DAY_LENGTH) / DAY_LENGTH; }
  get day() { return Math.floor(this.time / DAY_LENGTH) + 1; }
  get dead() { return this.health <= 0; }

  setDifficulty(difficulty) {
    this.difficulty = difficulty;
    if (difficulty === 'peaceful') {
      this.mobs = this.mobs.filter(mob => mob.kind === 'pig');
      this.food = MAX_VITAL;
      this.sickness = 0;
    }
  }

  hurt(amount) {
    if (this.dead || this.invulnerable > 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = .75;
    return true;
  }

  eat(item, inventory) {
    if (!isFood(item) || this.food >= MAX_VITAL || !inventory.withdraw(item, 1)) return false;
    this.food = Math.min(MAX_VITAL, this.food + FOOD[item]);
    if (item === ITEM.rottenFlesh && this.difficulty !== 'peaceful') this.sickness = 12;
    return true;
  }

  respawn(player, inventory) {
    const items = Object.fromEntries(ITEMS.filter(id => inventory.count(id)).map(id => [id, inventory.count(id)]));
    if (Object.keys(items).length) this.caches.push({x: player.x, y: player.y, z: player.z, items});
    for (const [id, count] of Object.entries(items)) inventory.withdraw(Number(id), count);
    this.health = this.food = MAX_VITAL;
    this.breath = MAX_BREATH;
    this.exhaustion = this.sickness = this.regen = 0;
    this.invulnerable = 3;
  }

  targetMob(player, blockHit) {
    const origin = [player.x, player.y + EYE_HEIGHT, player.z];
    const vector = direction(player.yaw, player.pitch);
    let nearest = null, limit = Math.min(3.6, blockHit?.distance ?? Infinity);
    for (const mob of this.mobs) {
      const {radius, height} = MOBS[mob.kind];
      const distance = rayBox(origin, vector, [mob.x - radius, mob.y, mob.z - radius],
        [mob.x + radius, mob.y + height, mob.z + radius], limit);
      if (distance < limit) {
        nearest = mob;
        limit = distance;
      }
    }
    return nearest;
  }

  attack(mob, item, inventory) {
    if (this.cooldown > 0) return '';
    this.cooldown = .36;
    this.exhaustion += .3;
    mob.health -= WEAPON_DAMAGE[item] ?? (inventory.tool ? 2 : 1);
    mob.hurt = .22;
    const kind = MOBS[mob.kind];
    if (mob.health > 0) return kind.name + ' · ' + mob.health + '/' + kind.health;
    this.mobs.splice(this.mobs.indexOf(mob), 1);
    inventory.deposit(kind.drop, kind.count);
    return mob.kind === 'pig' ? 'Получена сырая свинина' : 'Зомби повержен · гнилая плоть';
  }

  tick(dt, world, player, inventory, {moving, sprint, impact, levels}) {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    let message = '';
    const submerged = world.get(Math.floor(player.x), Math.floor(player.y + EYE_HEIGHT), Math.floor(player.z)) === BLOCK.water;
    this.breath = submerged ? Math.max(0, this.breath - dt) : MAX_BREATH;
    if (!this.breath) {
      this.breathHit += dt;
      if (this.breathHit >= 1 && this.hurt(2)) {
        message = 'Не хватает воздуха';
        this.breathHit = 0;
      }
    } else this.breathHit = 0;
    const fallDamage = Math.floor(impact * impact / 44 - 3);
    if (fallDamage > 0 && this.hurt(fallDamage)) message = 'Урон от падения';

    if (this.difficulty === 'normal') {
      this.exhaustion += dt * (this.sickness > 0 ? 1.4 : sprint ? .9 : moving ? .20 : .045);
      this.sickness = Math.max(0, this.sickness - dt);
      if (this.exhaustion >= 4) {
        this.exhaustion -= 4;
        this.food = Math.max(0, this.food - 1);
      }
    }
    this.regen += dt;
    if (this.regen >= 4 && !this.dead) {
      if (this.food >= 18 && this.health < MAX_VITAL) {
        this.health = Math.min(MAX_VITAL, this.health + 1);
        if (this.difficulty === 'normal') this.exhaustion += 2;
      } else if (!this.food && this.health > 1 && this.hurt(1)) message = 'Голод отнимает здоровье';
      this.regen = 0;
    }

    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = 4;
      const pigs = this.mobs.filter(mob => mob.kind === 'pig');
      const zombies = this.mobs.length - pigs.length;
      const kind = pigs.length < 5 && !pigs.some(mob => Math.hypot(mob.x - player.x, mob.z - player.z) < 22) ? 'pig'
        : this.difficulty === 'normal' && isNight(this.phase) && zombies < 6 ? 'zombie'
          : pigs.length < 3 ? 'pig' : null;
      const spawned = kind && findSpawn(world, player, kind, levels);
      if (spawned) this.mobs.push(spawned);
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      const kind = MOBS[mob.kind];
      mob.hurt = Math.max(0, mob.hurt - dt);
      const distance = Math.hypot(mob.x - player.x, mob.y - player.y, mob.z - player.z);
      const hostile = mob.kind === 'zombie';
      if (hostile && !isNight(this.phase) && this.phase > .09 && this.phase < .57 && openSky(world, mob, kind.height)) {
        mob.health -= dt * 4;
      }
      if (mob.health <= 0 || (hostile && distance > 36) || world.collides(mob, kind.radius, kind.height)) {
        this.mobs.splice(i, 1);
        continue;
      }
      const chasing = hostile && distance < 17 && canSee(world, mob, player, kind.height);
      mob.wander -= dt;
      if (chasing) {
        mob.yaw = Math.atan2(player.x - mob.x, mob.z - player.z);
        if (distance < 1.5 && this.hurt(3)) message = 'Зомби атаковал';
      } else if (mob.wander <= 0) {
        mob.yaw += (Math.random() - .5) * Math.PI * 1.6;
        mob.wander = 1.7 + Math.random() * 3;
      }
      const speed = chasing ? distance > 1.15 ? kind.speed : 0 : kind.speed * .55;
      moveMob(world, mob, kind, speed, dt);
    }

    if (!this.dead) {
      for (let i = this.caches.length - 1; i >= 0; i--) {
        const cache = this.caches[i];
        if (Math.hypot(cache.x - player.x, cache.y - player.y, cache.z - player.z) > 1.4) continue;
        for (const [id, count] of Object.entries(cache.items)) inventory.deposit(Number(id), count);
        this.caches.splice(i, 1);
        message = 'Потерянные вещи возвращены';
      }
    }
    return message;
  }
}
