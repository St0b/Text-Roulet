import {$, el, on, settings} from './core.js';
import {wm} from './windows.js';
import {GALAXY_CAMPAIGN_KEY, MAX_UPGRADE, SECTORS, UPGRADES, readCampaign, changeCampaign, rewardCampaign, upgradeCost, buyUpgrade} from './galaxy-campaign.js';

const WIDTH = 480;
const HEIGHT = 408;
const BEST_KEY = 'greenos-galaxy-best-v1';
const limit = (value, min, max) => Math.max(min, Math.min(max, value));
const overlaps = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= a.radius + b.radius;
const random = (min, max) => min + Math.random() * (max - min);
const ENEMIES = [
  {color:'#ff6f9a', light:'#ffafbc', hp:1, radius:11, speed:59, score:100, sprite:['..1...1..','.121.121.','112111211','122212221','..11.11..','.1.....1.']},
  {color:'#9b80ff', light:'#d9bfff', hp:2, radius:13, speed:44, score:180, sprite:['....1....','1..121..1','111222111','.1122211.','..11.11..','..2...2..']},
  {color:'#ffa858', light:'#ffdda1', hp:3, radius:15, speed:33, score:280, sprite:['.11...11.','1121.1211','111222111','.1122211.','...111...','..2...2..']},
];
const BOSS = {color:'#d284ff', light:'#fff1ba', radius:39, score:1600,
  sprite:['.....1...1.....','1...112.211...1','11.112222211.11','111122212221111','.1122111112211.','..11122222111..','...11.111.11...','..22.......22..']};
const BONUSES = {
  spread: {label:'Усиление залпа', symbol:'W', color:'#9b97ff'},
  shield: {label:'Энергетический щит', symbol:'S', color:'#62e1f0'},
  repair: {label:'Восстановление корпуса', symbol:'+', color:'#83edaa'},
  scrap: {label:'Обломки подобраны', symbol:'◆', color:'#f5c171'},
};

function bestScore() {
  try {
    const score = Number.parseInt(localStorage.getItem(BEST_KEY), 10);
    return Number.isSafeInteger(score) ? Math.max(0, score) : 0;
  }
  catch { return 0; }
}

const arcadeUpgrades = {weapon:0, armor:0, engine:0, magnet:0};
const sectorAt = run => SECTORS[run.sector];
const waveAt = run => sectorAt(run)?.waves[run.wave - 1];
const strength = run => run.wave + (run.sector ?? 0) * 2;
function shipsInWave(run) {
  const plan = waveAt(run);
  if (plan) return plan.ships ?? 1;
  return run.wave % 4 === 0 ? 1 : Math.min(25, 8 + run.wave * 2);
}

function createRun(sector=null,upgrades=arcadeUpgrades) {
  const maxHull = 3 + upgrades.armor;
  const run = {sector, wave:1, score:0, kills:0, scrap:0, time:0, nextShip:.28, waiting:0, finished:false,
    player:{x:WIDTH / 2, y:HEIGHT - 40, radius:9, hull:maxHull, maxHull, upgrades:{...upgrades},
      spread:0, shield:false, grace:0, cooldown:0},
    enemies:[], lasers:[], fire:[], bonuses:[], particles:[]};
  run.remaining = sector == null ? 9 : shipsInWave(run);
  return run;
}

function spawnEnemy(run) {
  const {wave, remaining} = run;
  const plan = waveAt(run);
  if (plan?.boss || !plan && wave % 4 === 0) {
    const hp = plan?.hp ?? 22 + wave * 2;
    run.enemies.push({kind:BOSS, hp, maxHp:hp, x:WIDTH / 2, y:-44, radius:BOSS.radius, attack:2.5, boss:true});
    return;
  }
  const tier = plan ? Math.max(0,(plan.tier ?? 0) - Number(remaining % 3 !== 1))
    : wave > 2 && remaining % 5 === 1 ? 2 : wave > 1 && remaining % 3 === 1 ? 1 : 0;
  const kind = ENEMIES[tier];
  let lane = 46 + ((remaining * 3 + wave) % 8) * 55;
  if (plan?.formation === 'line') lane = 46 + (plan.ships - remaining) % 8 * 55;
  if (plan?.formation === 'wings') lane = WIDTH / 2 + (remaining % 2 ? -1 : 1) * (57 + remaining % 4 * 32);
  run.enemies.push({kind, x:lane, y:-16, lane, radius:kind.radius, hp:kind.hp,
    phase:random(0, Math.PI * 2), attack:random(1.5, 2.8)});
}

function burst(run, x, y, color, count) {
  for (let i = 0; i < count && run.particles.length < 105; i++) {
    run.particles.push({x, y, color, vx:random(-88,88), vy:random(-78,92), ttl:random(.18,.53)});
  }
}

function fireAtPlayer(run, enemy, arc) {
  const bearing = Math.atan2(run.player.y - enemy.y, run.player.x - enemy.x);
  const speed = Math.min(235, 108 + strength(run) * 9);
  const angle = bearing + arc;
  run.fire.push({x:enemy.x, y:enemy.y + enemy.radius * .55, radius:4, vx:Math.cos(angle) * speed,
    vy:Math.max(50,Math.sin(angle) * speed)});
}

function updateRun(run, dt, input, effects) {
  const {player} = run;
  const {weapon, engine, magnet} = player.upgrades;
  run.time += dt;
  player.grace = Math.max(0, player.grace - dt);
  player.spread = Math.max(0, player.spread - dt);
  player.cooldown = Math.max(0, player.cooldown - dt);
  const moveX = input.target ? input.target.x - player.x : input.x;
  const moveY = input.target ? input.target.y - player.y : input.y;
  const distance = Math.hypot(moveX, moveY);
  if (distance) {
    const speed = 1 + .12 * engine;
    const step = input.target ? Math.min(distance, 650 * speed * dt) : 267 * speed * dt;
    player.x = limit(player.x + moveX / distance * step, 16, WIDTH - 16);
    player.y = limit(player.y + moveY / distance * step, 46, HEIGHT - 19);
  }
  if (input.shoot && !player.cooldown) {
    player.cooldown = .17 - weapon * .015;
    const spread = player.spread || weapon >= 4;
    for (const dx of spread ? [-115, 0, 115] : weapon >= 2 ? [-42, 42] : [0]) {
      run.lasers.push({x:player.x, y:player.y - 13, radius:4, vx:dx, vy:-455, damage:weapon >= 3 ? 2 : 1});
    }
  }
  if (run.remaining > 0) {
    run.nextShip -= dt;
    if (run.nextShip <= 0) {
      spawnEnemy(run);
      run.remaining--;
      run.nextShip = Math.max(.34, .66 - strength(run) * .025);
    }
  } else if (!run.enemies.length) {
    run.waiting += dt;
    if (run.waiting > 1.15) {
      if (run.sector !== null && run.wave === sectorAt(run).waves.length) {
        run.finished = true;
        return;
      }
      run.wave++;
      run.waiting = 0;
      run.nextShip = .18;
      run.remaining = shipsInWave(run);
      effects.announce(waveAt(run)?.boss || run.sector === null && run.wave % 4 === 0 ? 'В сектор вошёл флагман.' : `Волна ${run.wave}`);
    }
  }
  for (const enemy of run.enemies) {
    if (enemy.boss) {
      enemy.y = Math.min(68, enemy.y + dt * 42);
      enemy.x = WIDTH / 2 + Math.sin(run.time * .91) * 129;
    } else {
      enemy.y += dt * (enemy.kind.speed + Math.min(strength(run) * 2.5, 38));
      enemy.x = enemy.lane + Math.sin(run.time * 2.15 + enemy.phase) * (14 + enemy.radius);
    }
    enemy.attack -= dt;
    if (enemy.attack <= 0 && enemy.y > 18 && enemy.y < player.y - 28) {
      const angles = enemy.boss ? [-.48, -.24, 0, .24, .48] : [0];
      for (const arc of angles) fireAtPlayer(run, enemy, arc);
      enemy.attack = enemy.boss ? 1.24 : random(2.35, 4.1);
    }
  }
  for (const projectile of [...run.lasers, ...run.fire]) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    if (projectile.x < -15 || projectile.x > WIDTH + 15 || projectile.y < -20 || projectile.y > HEIGHT + 18) {
      projectile.dead = true;
    }
  }
  for (const enemy of run.enemies) {
    for (const laser of run.lasers) {
      if (laser.dead || !overlaps(enemy, laser)) continue;
      laser.dead = true;
      enemy.hp -= laser.damage;
      if (enemy.hp > 0) continue;
      run.score += enemy.kind.score;
      run.kills++;
      if (run.sector !== null) {
        run.scrap += enemy.boss ? 8 : enemy.kind.hp;
        if (run.kills % 3 === 0 || enemy.boss) {
          run.bonuses.push({x:enemy.x + 16, y:enemy.y, radius:9, type:'scrap', value:enemy.boss ? 8 : 3});
        }
      }
      burst(run, enemy.x, enemy.y, enemy.kind.color, effects.motion ? 15 : 4);
      if (run.kills % 4 === 0 || enemy.boss) {
        const type = enemy.boss ? 'repair' : ['spread','shield','repair'][(run.kills / 4 - 1) % 3];
        run.bonuses.push({x:enemy.x, y:enemy.y, radius:10, type});
      }
      effects.tone(enemy.boss ? 235 : 125);
      break;
    }
    if (enemy.hp > 0 && overlaps(player, enemy) && !player.grace) {
      if (!enemy.boss) enemy.hp = 0;
      damage(run, effects);
    }
  }
  for (const shot of run.fire) {
    if (!shot.dead && !player.grace && overlaps(player, shot)) {
      shot.dead = true;
      damage(run, effects);
    }
  }
  for (const bonus of run.bonuses) {
    bonus.y += dt * 65;
    const distance = Math.hypot(player.x - bonus.x, player.y - bonus.y);
    if (magnet && distance && distance < 25 + magnet * 23) {
      const step = Math.min(distance, (145 + magnet * 52) * dt);
      bonus.x += (player.x - bonus.x) * step / distance;
      bonus.y += (player.y - bonus.y) * step / distance;
    }
    if (bonus.y > HEIGHT + 11 || (overlaps(player, bonus) && player.hull > 0)) {
      bonus.dead = true;
      if (bonus.y > HEIGHT + 11) continue;
      if (bonus.type === 'spread') player.spread = 10;
      if (bonus.type === 'shield') player.shield = true;
      if (bonus.type === 'repair') player.hull = Math.min(player.maxHull, player.hull + 1);
      if (bonus.type === 'scrap') run.scrap += bonus.value;
      effects.announce(BONUSES[bonus.type].label + (bonus.type === 'scrap' ? ` · +${bonus.value}` : ''));
      effects.tone(520);
    }
  }
  for (const particle of run.particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.ttl -= dt;
  }
  run.enemies = run.enemies.filter(enemy => enemy.hp > 0 && enemy.y < HEIGHT + 45);
  run.lasers = run.lasers.filter(shot => !shot.dead);
  run.fire = run.fire.filter(shot => !shot.dead);
  run.bonuses = run.bonuses.filter(bonus => !bonus.dead);
  run.particles = run.particles.filter(particle => particle.ttl > 0);
}

function damage(run, effects) {
  const {player} = run;
  player.grace = 1.14;
  if (player.shield) player.shield = false;
  else player.hull--;
  burst(run, player.x, player.y, '#ff7a9d', effects.motion ? 16 : 4);
  effects.tone(68);
}

function sprite(ctx, image, x, y, scale, colors) {
  const left = Math.round(x - image[0].length * scale / 2);
  const top = Math.round(y - image.length * scale / 2);
  image.forEach((row, iy) => {
    for (let ix = 0; ix < row.length; ix++) {
      if (row[ix] === '.') continue;
      ctx.fillStyle = colors[row[ix]];
      ctx.fillRect(left + ix * scale, top + iy * scale, scale, scale);
    }
  });
}

function rgb(hex) {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}

function mixColor(base, tint, amount) {
  return base.map((channel, index) => Math.round(channel + (tint[index] - channel) * amount));
}

function luminance(color) {
  return color.reduce((value, channel, index) => {
    const normalized = channel / 255;
    const linear = normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    return value + [.2126, .7152, .0722][index] * linear;
  }, 0);
}

function contrast(color, background) {
  const front = luminance(color) + .05;
  const back = luminance(background) + .05;
  return Math.max(front, back) / Math.min(front, back);
}

function contrastInk(background) {
  const black = [0, 0, 0], white = [255, 255, 255];
  return contrast(black, background) > contrast(white, background) ? black : white;
}

function visibleColor(color, background, minimum) {
  const ink = contrastInk(background);
  for (let step = 0; step < 10; step++) {
    const candidate = mixColor(color, ink, step / 10);
    if (contrast(candidate, background) >= minimum) return candidate;
  }
  return ink;
}

const cssColor = color => `rgb(${color.join(', ')})`;

function makePalette(theme, accent) {
  const light = theme === 'light';
  const raw = rgb(/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#a5d890');
  const tint = (base, strength) => mixColor(rgb(base), raw, strength);
  const panel = tint(light ? '#f0f3fa' : '#171a2c', .12);
  const hud = tint(light ? '#e6edf8' : '#101529', .09);
  const field = [tint(light ? '#f7f7ff' : '#292344', .12),
    tint(light ? '#ebf0fc' : '#111d38', .09), tint(light ? '#dae4f4' : '#080b1c', .06)];
  const planet = [tint(light ? '#dbe2f5' : '#3b315c', .14),
    tint(light ? '#d5e0f2' : '#393258', .16), tint(light ? '#c8d5eb' : '#19162e', .12)];
  const background = light ? planet[2] : planet[0];
  const hudAccent = visibleColor(raw, light ? hud : panel, 5);
  const ship = [
    visibleColor(raw, background, 4.5),
    visibleColor(mixColor(raw, light ? [0, 0, 0] : [255, 255, 255], .42), background, 5.5),
    visibleColor(tint('#6575d7', .18), background, 3.2),
  ].map(cssColor);
  const enemyPaint = new Map([...ENEMIES, BOSS].map(kind => [kind, [
    cssColor(visibleColor(rgb(kind.color), background, 3.5)),
    cssColor(visibleColor(rgb(kind.light), background, 4.7)),
  ]]));
  const danger = ['#ff5982', '#ffc6d1'].map(color => cssColor(visibleColor(rgb(color), background, 4.5)));
  return {field:field.map(cssColor), planet:planet.map(cssColor), ring:light ? '#6e709480' : '#9b8dc641',
    stars:[tint(light ? '#7d8bab' : '#697595', .22), tint(light ? '#5e7291' : '#b2b8d8', .28),
      visibleColor(raw, background, 3)].map(cssColor),
    ship, enemyPaint, danger, bonusInk:new Map(Object.entries(BONUSES).map(([id, bonus]) =>
      [id, cssColor(visibleColor(rgb(bonus.color), background, 4.5))])),
    css:{panel:cssColor(panel), hud:cssColor(hud), space:cssColor(field[2]), accent:cssColor(hudAccent),
      'button-ink':cssColor(contrastInk(hudAccent))}};
}

function galaxyRenderer(canvas, motion) {
  const ctx = canvas.getContext('2d');
  const orbits = [
    {x:407,y:109,radius:63,ring:true}, {x:118,y:123,radius:37,moon:true},
    {x:390,y:186,radius:82}, {x:283,y:97,radius:67,ring:true},
    {x:101,y:98,radius:75,moon:true}, {x:337,y:163,radius:95,ring:true,moon:true},
  ];
  let palette, backdrop, planet, paintedSector;
  function setPalette(next) {
    palette = next;
    backdrop = ctx.createRadialGradient(335, 138, 12, 345, 140, 383);
    palette.field.forEach((color, index) => backdrop.addColorStop([0, .48, 1][index], color));
    paintedSector=undefined;
  }
  const stars = Array.from({length:82}, (_, index) => ({
    x:(index * 131 + 19) % WIDTH, y:(index * 89 + 37) % HEIGHT, layer:index % 3, size:index % 8 === 0 ? 2 : 1,
  }));
  const ship = ['.....2.....','.....2.....','....121....','....131....','2...131...2','21.11311.12','21111111112','22211111222','..2.1.1.2..'];
  function draw(run) {
    const index = run.sector ?? 0;
    const {x,y,radius,ring,moon} = orbits[index] ?? orbits[0];
    if (paintedSector!==index) {
      planet = ctx.createRadialGradient(x - radius * .5, y - radius * .38, 2, x, y, radius * 1.2);
      palette.planet.forEach((color, i) => planet.addColorStop([0, .55, 1][i], color));
      paintedSector=index;
    }
    ctx.fillStyle = backdrop;
    ctx.fillRect(0,0,WIDTH,HEIGHT);
    ctx.fillStyle = planet;
    ctx.beginPath();
    ctx.arc(x,y,radius,0,Math.PI*2);
    ctx.fill();
    if (ring) {
      ctx.strokeStyle = palette.ring;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x - 3,y + 5,radius * 1.45,radius * .24,-.34,0,Math.PI*2);
      ctx.stroke();
    }
    if (moon) {
      ctx.fillStyle = palette.planet[0];
      ctx.beginPath();
      ctx.arc(WIDTH - x,y + 51,11,0,Math.PI*2);
      ctx.fill();
    }
    for (const {x,y,layer,size} of stars) {
      ctx.fillStyle = palette.stars[layer];
      const shift = motion.matches ? 0 : run.time * (15 + layer * 15);
      ctx.fillRect(x, (y + shift) % HEIGHT, size, size);
    }
    for (const enemy of run.enemies) {
      const {kind,x,y} = enemy;
      const [body, shine] = palette.enemyPaint.get(kind);
      sprite(ctx,kind.sprite,x,y,enemy.boss ? 5 : 3,{1:body,2:shine});
      if (enemy.boss) {
        ctx.fillStyle = '#13152d';
        ctx.fillRect(x-45,y-28,90,4);
        ctx.fillStyle = shine;
        ctx.fillRect(x-45,y-28,90 * enemy.hp / enemy.maxHp,4);
      }
    }
    for (const laser of run.lasers) {
      ctx.fillStyle = palette.ship[0];
      ctx.fillRect(laser.x-2,laser.y-9,4,12);
      ctx.fillStyle = palette.ship[1];
      ctx.fillRect(laser.x-1,laser.y-10,2,8);
    }
    for (const shot of run.fire) {
      ctx.fillStyle = palette.danger[0];
      ctx.fillRect(shot.x-3,shot.y-3,6,6);
      ctx.fillStyle = palette.danger[1];
      ctx.fillRect(shot.x-1,shot.y-1,2,2);
    }
    for (const bonus of run.bonuses) {
      const {symbol} = BONUSES[bonus.type];
      const color = palette.bonusInk.get(bonus.type);
      ctx.fillStyle = palette.css.hud;
      ctx.fillRect(bonus.x-9,bonus.y-9,18,18);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bonus.x-9,bonus.y-9,18,18);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(symbol,bonus.x,bonus.y+4);
    }
    const {player} = run;
    if (player.hull > 0 && (!player.grace || motion.matches || Math.floor(run.time * 16) % 2)) {
      const {x,y} = player;
      sprite(ctx,ship,x,y,3,{1:palette.ship[0],2:palette.ship[1],3:palette.ship[2]});
      ctx.fillStyle = palette.ship[1];
      ctx.fillRect(x-3,y+13,6,5);
      ctx.fillStyle = palette.ship[2];
      ctx.fillRect(x-2,y+18,4,4 + (motion.matches ? 0 : Math.sin(run.time*30)*2));
      if (player.shield) {
        ctx.beginPath();
        ctx.strokeStyle = palette.ship[1];
        ctx.lineWidth = 2;
        ctx.arc(x,y,23,0,Math.PI*2);
        ctx.stroke();
      }
    }
    for (const particle of run.particles) {
      ctx.globalAlpha = limit(particle.ttl * 3, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x,particle.y,3,3);
    }
    ctx.globalAlpha = 1;
  }
  return {draw, setPalette};
}

function galaxyGame(root, win) {
  const controller = new AbortController();
  const {signal} = controller;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  root.classList.add('galaxy-content');
  root.innerHTML = `
    <section class="galaxy-cabinet" aria-label="Галактика">
      <header class="galaxy-header">
        <div><small>GREENOS ARCADE · ОРБИТАЛЬНЫЙ ПАТРУЛЬ</small><h2>Галактика</h2></div>
        <button class="galaxy-sound" type="button" aria-pressed="false">Звук выкл.</button>
        <button class="galaxy-pause" type="button" disabled>Пауза</button>
      </header>
      <div class="galaxy-layout">
        <div class="galaxy-flight">
          <div class="galaxy-hud">
            <div><span>СЧЁТ</span><strong data-stat="score"></strong></div>
            <div><span title="Рекорд бесконечной аркады">РЕКОРД</span><strong data-stat="best"></strong></div>
            <div><span>ВОЛНА</span><strong data-stat="wave"></strong></div>
            <div><span>КОРПУС</span><strong data-stat="hull"></strong></div>
            <div><span>ОБЛОМКИ</span><strong data-stat="scrap"></strong></div>
          </div>
          <div class="galaxy-stage">
            <canvas width="${WIDTH}" height="${HEIGHT}" tabindex="0" aria-label="Игровое поле. Стрелки или WASD — движение, пробел — стрельба"></canvas>
            <div class="galaxy-overlay">
              <div class="galaxy-message">
                <span class="galaxy-kicker"></span>
                <strong class="galaxy-title"></strong>
                <p class="galaxy-summary"></p>
                <button class="galaxy-action" type="button">Начать полёт</button>
                <button class="galaxy-leave" type="button" hidden>Завершить вылет</button>
              </div>
            </div>
          </div>
          <p class="galaxy-status" role="status">Готов к вылету</p>
          <p class="galaxy-help"><kbd>WASD</kbd> / <kbd>↑←↓→</kbd> движение · <kbd>Пробел</kbd> огонь · <kbd>P</kbd> пауза<br>Мышь или палец на поле — движение и огонь</p>
        </div>
        <aside class="galaxy-sidebar" aria-label="Штаб патруля">
          <div class="galaxy-wallet"><span>ОБЛОМКИ НА БАЗЕ</span><strong class="galaxy-bank"></strong></div>
          <div class="galaxy-tabs" role="group" aria-label="Режим и ангар">
            <button type="button" data-galaxy-panel="map">Секторы</button>
            <button type="button" data-galaxy-panel="hangar">Ангар</button>
            <button type="button" data-galaxy-panel="arcade">Аркада</button>
          </div>
          <div class="galaxy-panel"></div>
        </aside>
      </div>
    </section>`;
  const canvas = $('canvas',root);
  const renderer = galaxyRenderer(canvas,motion);
  const overlay = $('.galaxy-overlay',root);
  const title = $('.galaxy-title',root);
  const summary = $('.galaxy-summary',root);
  const action = $('.galaxy-action',root);
  const leaveButton = $('.galaxy-leave',root);
  const kicker = $('.galaxy-kicker',root);
  const bank = $('.galaxy-bank',root);
  const panelBody = $('.galaxy-panel',root);
  const tabs = [...root.querySelectorAll('[data-galaxy-panel]')];
  const pauseButton = $('.galaxy-pause',root);
  const soundButton = $('.galaxy-sound',root);
  const status = $('.galaxy-status',root);
  const stats = Object.fromEntries([...root.querySelectorAll('[data-stat]')].map(node => [node.dataset.stat,node]));
  const keys = new Set();
  const controls = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Space']);
  let progress = readCampaign(), selected = Math.min(progress.cleared,SECTORS.length - 1);
  let best = bestScore(), run = createRun(selected,progress.upgrades), phase = 'ready', target, pointerId;
  let panel = 'map', mode = 'campaign', changing = false;
  let frame = 0, previous, audio;
  let sound = false;

  function announce(message) { if (status.textContent !== message) status.textContent = message; }
  function tone(freq) {
    if (!sound || audio?.state !== 'running') return;
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    const now = audio.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(freq,now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(42,freq / 1.7),now+.13);
    volume.gain.setValueAtTime(.085,now);
    volume.gain.exponentialRampToValueAtTime(.001,now+.14);
    oscillator.connect(volume).connect(audio.destination);
    oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
    oscillator.start(now);
    oscillator.stop(now+.15);
  }
  soundButton.onclick = async () => {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) { soundButton.disabled = true; return; }
    try {
      if (!audio) audio = new Audio();
      sound = !sound;
      if (sound) await audio.resume();
      if (sound) tone(480);
    } catch { sound = false; }
    soundButton.textContent = sound ? 'Звук вкл.' : 'Звук выкл.';
    soundButton.setAttribute('aria-pressed',String(sound));
  };

  function saveRecord() {
    if (run.sector !== null) return;
    const stored = bestScore();
    best = Math.max(best, run.score, stored);
    if (best > stored) {
      try { localStorage.setItem(BEST_KEY,String(best)); } catch { /* The current record remains visible. */ }
    }
  }
  function render() {
    if (run.sector === null) best = Math.max(best, run.score);
    const values = {score:String(run.score).padStart(5,'0'), best:String(best).padStart(5,'0'),
      wave:run.sector === null ? String(run.wave).padStart(2,'0') : `${run.wave}/${sectorAt(run).waves.length}`,
      hull:`${run.player.hull}/${run.player.maxHull}${run.player.shield ? ' ◈' : ''}`, scrap:String(run.scrap)};
    for (const [name,value] of Object.entries(values)) if (stats[name].textContent !== value) stats[name].textContent = value;
    renderer.draw(run);
  }

  function menuLocked() { return ['running','paused','settling'].includes(phase) || changing; }

  async function purchase(id) {
    if (menuLocked()) return;
    const level=progress.upgrades[id];
    changing=true;
    renderMenu();
    try {
      const result = await changeCampaign(value=>buyUpgrade(value,id),progress);
      if (signal.aborted) return;
      progress=result.value;
      if (!result.writable) announce('Не удалось сохранить покупку в браузере.');
      else if (progress.upgrades[id] > level) {
        announce(UPGRADES[id].name+' · уровень '+progress.upgrades[id]);
        if (phase==='ready' && mode==='campaign') {
          run=createRun(selected,progress.upgrades);
          render();
        }
      } else announce('Уровень уже установлен или обломков не хватает.');
    } catch { announce('Не удалось сохранить покупку в браузере.'); }
    finally {
      changing=false;
      if (!signal.aborted) {
        renderMenu();
        if (active()) panelBody.querySelector(`[data-upgrade="${id}"]:not(:disabled)`)?.focus({preventScroll:true});
      }
    }
  }

  function renderMenu() {
    const locked=menuLocked();
    bank.textContent='◆ '+progress.scrap;
    for (const tab of tabs) {
      tab.disabled=locked;
      tab.setAttribute('aria-pressed',String(tab.dataset.galaxyPanel===panel));
    }
    if (panel==='hangar') {
      panelBody.replaceChildren(el('h3',{},'Модули корабля'),
        el('p',{},'Модули действуют в кампании. Обломки остаются после каждого завершённого вылета.'),
        ...Object.entries(UPGRADES).map(([id,upgrade])=>{
          const level=progress.upgrades[id], cost=upgradeCost(id,level);
          const button=el('button',{type:'button','data-upgrade':id,disabled:locked || level===MAX_UPGRADE || progress.scrap<cost,
            'aria-label':'Улучшить модуль «'+upgrade.name+'»', onclick:()=>void purchase(id)},
          level===MAX_UPGRADE?'Макс.':'◆ '+cost);
          return el('article',{class:'galaxy-upgrade'},
            el('div',{},el('h4',{},upgrade.name+' '+level+'/'+MAX_UPGRADE),el('p',{},upgrade.description)),button);
        }));
      return;
    }
    if (panel==='arcade') {
      panelBody.replaceChildren(el('h3',{},'Бесконечный патруль'),
        el('p',{},'Сражайтесь за рекорд в бесконечной аркаде. Каждая четвёртая волна — флагман. Корабль стартует в базовой комплектации.'));
      return;
    }
    panelBody.replaceChildren(el('h3',{},`Кампания · ${progress.cleared}/${SECTORS.length}`),
      el('p',{},'Отвечайте на вызовы колонии и возвращайтесь в пройденные секторы за обломками.'),
      el('ol',{class:'galaxy-map'},...SECTORS.map((sector,index)=>{
        const done=index<progress.cleared;
        const available=index<=progress.cleared;
        const button=el('button',{type:'button',class:'galaxy-mission','aria-pressed':String(selected===index),
          disabled:locked || !available, onclick:()=>{
            selected=index;
            mode='campaign';
            prepare();
            panelBody.querySelector(`[data-sector="${index}"]`)?.focus({preventScroll:true});
          },'data-sector':index},
          el('span',{class:'galaxy-sector-number'},String(index+1).padStart(2,'0')),
          el('span',{},el('strong',{},sector.name),el('small',{},available?sector.location:'Пройдите предыдущий сектор')),
          el('span',{class:'galaxy-sector-check','aria-label':done?'Сектор пройден':available?'Открыт':'Закрыт'},done?'✓':available?'›':'·'));
        return el('li',{},button);
      })));
  }

  function prepare() {
    run = mode==='campaign' ? createRun(selected,progress.upgrades) : createRun();
    const sector=sectorAt(run);
    kicker.textContent = sector ? `СЕКТОР ${selected+1} · ${sector.location}` : 'БЕСКОНЕЧНАЯ АРКАДА';
    const briefing=sector ? sector.story + (selected>=progress.cleared?` Первый успех · ◆ ${sector.reward}.`:'')
      : 'Уклоняйтесь от залпов и сбивайте корабли. Каждая четвёртая волна — флагман.';
    stop('ready',sector?.name??'Сектор Ω',briefing,'Начать полёт');
    announce('Готов к вылету');
    render();
  }

  for (const tab of tabs) tab.onclick=()=>{
    if (menuLocked()) return;
    panel=tab.dataset.galaxyPanel;
    if (panel==='hangar') renderMenu();
    else {
      mode=panel==='arcade'?'arcade':'campaign';
      prepare();
    }
  };
  window.addEventListener('storage',event=>{
    if (event.key!==GALAXY_CAMPAIGN_KEY && event.key!==null) return;
    progress=readCampaign();
    if (phase==='ready') {
      selected=Math.min(selected,progress.cleared,SECTORS.length-1);
      prepare();
    } else renderMenu();
  },{signal});

  let theme, accent;
  function updateTheme() {
    const nextTheme = settings.get('theme');
    const nextAccent = settings.get('accent');
    if (theme === nextTheme && accent === nextAccent) return;
    theme = nextTheme;
    accent = nextAccent;
    const palette = makePalette(theme, accent);
    for (const [property, value] of Object.entries(palette.css)) root.style.setProperty(`--galaxy-${property}`, value);
    renderer.setPalette(palette);
    render();
  }
  on('settings', updateTheme, signal);
  function active() {
    return wm.active === win && !win.minimized && !win.element.hidden && !document.hidden &&
      !$('#system-dialog')?.open && $('#lock-screen')?.hidden !== false && $('#launcher')?.hidden !== false &&
      $('#window-overview')?.hidden !== false;
  }
  function clearInput() {
    keys.clear();
    if (pointerId != null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = target = undefined;
  }
  function stop(next, heading, message, button) {
    phase = next;
    cancelAnimationFrame(frame);
    clearInput();
    saveRecord();
    title.textContent = heading;
    summary.textContent = message;
    action.textContent = button;
    action.disabled = next==='settling';
    leaveButton.hidden = next!=='paused';
    overlay.hidden = false;
    pauseButton.disabled = true;
    announce(heading);
    renderMenu();
  }
  function pause(message = 'Продолжите полёт, когда будете готовы.') {
    if (phase === 'running') stop('paused','Пауза',message,'Продолжить');
  }

  async function finish(success=false, abandoned=false) {
    const sector=sectorAt(run);
    if (!sector) {
      stop('over',abandoned?'Вылет завершён':'Корабль потерян',`Счёт ${run.score} · волна ${run.wave} · рекорд ${Math.max(best,run.score)}`,'Новый полёт');
      return;
    }
    const heading=success?'Сектор пройден':abandoned?'Вылет завершён':'Корабль потерян';
    const report=success?sector.report:`Счёт ${run.score} · волна ${run.wave}/${sector.waves.length}`;
    stop('settling',heading,'Записываем результат вылета…','Подождите…');
    let gained=0, saved=false;
    try {
      const result=await changeCampaign(value=>{
        const next=rewardCampaign(value,run.sector,success,run.scrap);
        gained=next.scrap-value.scrap;
        return next;
      },progress);
      progress=result.value;
      saved=result.writable;
    } catch { /* The result screen reports storage failures. */ }
    if (signal.aborted) return;
    const resultText=saved?`Обломки за вылет · ◆ ${gained}.`:'Не удалось сохранить результат в браузере.';
    const nextLabel=run.sector+1<SECTORS.length && progress.cleared>run.sector?'Следующий сектор':'К карте секторов';
    stop(success?'cleared':'over',heading,report+' '+resultText,success?nextLabel:'Повторить вылет');
    if (active()) action.focus({preventScroll:true});
  }

  function tick(now) {
    if (!active()) { pause('Полёт приостановлен. Вернитесь в окно игры.'); return; }
    const dt = previous == null ? 0 : Math.min((now - previous) / 1000,.035);
    previous = now;
    const pressed = (first,second) => Number(keys.has(first) || keys.has(second));
    updateRun(run,dt,{target, x:pressed('KeyD','ArrowRight')-pressed('KeyA','ArrowLeft'),
      y:pressed('KeyS','ArrowDown')-pressed('KeyW','ArrowUp'), shoot:keys.has('Space') || Boolean(target)},
      {announce,tone,motion:!motion.matches});
    render();
    if (run.player.hull <= 0 || run.finished) {
      void finish(run.finished);
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  action.onclick = () => {
    if (!active() || ['running','settling'].includes(phase) || changing) return;
    if (phase==='cleared') {
      if (selected<SECTORS.length-1 && selected<progress.cleared) selected++;
      panel='map';
      prepare();
      action.focus({preventScroll:true});
      return;
    }
    if (phase !== 'paused') {
      run = mode==='campaign' ? createRun(selected,progress.upgrades) : createRun();
      announce('Волна 1');
    } else announce(`Волна ${run.wave} · полёт продолжен`);
    phase = 'running';
    previous = undefined;
    overlay.hidden = true;
    pauseButton.disabled = false;
    renderMenu();
    canvas.focus({preventScroll:true});
    frame = requestAnimationFrame(tick);
  };
  leaveButton.onclick = () => { if (phase==='paused') void finish(false,true); };
  win.beforeClose = async () => {
    if (changing || phase==='settling') return false;
    if (phase==='running' || phase==='paused') await finish(false,true);
    return true;
  };
  pauseButton.onclick = () => { pause(); action.focus({preventScroll:true}); };
  document.addEventListener('keydown',event => {
    if (!active() || event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.('input,textarea,select,[contenteditable]')) return;
    if (event.code === 'KeyP' && !event.repeat) {
      if (phase === 'running') { pause(); action.focus({preventScroll:true}); }
      else if (phase === 'paused') action.click();
      return;
    }
    if (phase !== 'running' || !controls.has(event.code) || (event.code === 'Space' && event.target.closest?.('button'))) return;
    event.preventDefault();
    keys.add(event.code);
  },{signal});
  document.addEventListener('keyup',event => keys.delete(event.code),{signal});
  window.addEventListener('blur',() => pause(),{signal});
  document.addEventListener('visibilitychange',() => { if (document.hidden) pause(); },{signal});
  on('focus',focused => { if (focused !== win) pause(); },signal);
  on('lock',locked => { if (locked) pause(); },signal);
  function aim(event) {
    const box = canvas.getBoundingClientRect();
    target = {x:(event.clientX - box.left) * WIDTH / box.width,
      y:(event.clientY - box.top) * HEIGHT / box.height - (event.pointerType === 'touch' ? 20 : 0)};
  }
  canvas.addEventListener('pointerdown',event => {
    if (phase !== 'running' || !active() || event.button !== 0 || pointerId != null) return;
    event.preventDefault();
    canvas.focus({preventScroll:true});
    canvas.setPointerCapture(event.pointerId);
    pointerId = event.pointerId;
    aim(event);
  },{signal});
  canvas.addEventListener('pointermove',event => { if (event.pointerId === pointerId) aim(event); },{signal});
  for (const type of ['pointerup','pointercancel','lostpointercapture']) {
    canvas.addEventListener(type,event => { if (event.pointerId === pointerId) pointerId = target = undefined; },{signal});
  }
  updateTheme();
  prepare();
  return () => {
    cancelAnimationFrame(frame);
    saveRecord();
    clearInput();
    controller.abort();
    audio?.close().catch(() => {});
    root.classList.remove('galaxy-content');
  };
}

export const galaxyApp = {
  id:'galaxy', name:'Галактика', subtitle:'Кампания, ангар и аркада', keywords:'galaxy arcade шутер космос',
  icon:'games', singleton:true, width:850, height:690,
  mount(win) { return galaxyGame(win.body, win); },
};
