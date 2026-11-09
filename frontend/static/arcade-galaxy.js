import {$, on} from './core.js';
import {wm} from './windows.js';

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
};

function bestScore() {
  try {
    const score = Number.parseInt(localStorage.getItem(BEST_KEY), 10);
    return Number.isSafeInteger(score) ? Math.max(0, score) : 0;
  }
  catch { return 0; }
}

function createRun() {
  return {wave:1, score:0, kills:0, time:0, nextShip:.28, waiting:0, remaining:9,
    player:{x:WIDTH / 2, y:HEIGHT - 40, radius:9, hull:3, spread:0, shield:false, grace:0, cooldown:0},
    enemies:[], lasers:[], fire:[], bonuses:[], particles:[]};
}

function spawnEnemy(run) {
  const {wave, remaining} = run;
  if (wave % 4 === 0) {
    const hp = 22 + wave * 2;
    run.enemies.push({kind:BOSS, hp, maxHp:hp, x:WIDTH / 2, y:-44, radius:BOSS.radius, attack:2.5, boss:true});
    return;
  }
  const tier = wave > 2 && remaining % 5 === 1 ? 2 : wave > 1 && remaining % 3 === 1 ? 1 : 0;
  const kind = ENEMIES[tier];
  const lane = 46 + ((remaining * 3 + wave) % 8) * 55;
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
  const speed = Math.min(235, 108 + run.wave * 9);
  const angle = bearing + arc;
  run.fire.push({x:enemy.x, y:enemy.y + enemy.radius * .55, radius:4, vx:Math.cos(angle) * speed,
    vy:Math.max(50,Math.sin(angle) * speed)});
}

function updateRun(run, dt, input, effects) {
  const {player} = run;
  run.time += dt;
  player.grace = Math.max(0, player.grace - dt);
  player.spread = Math.max(0, player.spread - dt);
  player.cooldown = Math.max(0, player.cooldown - dt);
  const moveX = input.target ? input.target.x - player.x : input.x;
  const moveY = input.target ? input.target.y - player.y : input.y;
  const distance = Math.hypot(moveX, moveY);
  if (distance) {
    const step = input.target ? Math.min(distance, 650 * dt) : 267 * dt;
    player.x = limit(player.x + moveX / distance * step, 16, WIDTH - 16);
    player.y = limit(player.y + moveY / distance * step, 46, HEIGHT - 19);
  }
  if (input.shoot && !player.cooldown) {
    player.cooldown = .17;
    for (const dx of player.spread ? [-115, 0, 115] : [0]) {
      run.lasers.push({x:player.x, y:player.y - 13, radius:4, vx:dx, vy:-455});
    }
  }
  if (run.remaining > 0) {
    run.nextShip -= dt;
    if (run.nextShip <= 0) {
      spawnEnemy(run);
      run.remaining--;
      run.nextShip = Math.max(.34, .66 - run.wave * .025);
    }
  } else if (!run.enemies.length) {
    run.waiting += dt;
    if (run.waiting > 1.15) {
      run.wave++;
      run.waiting = 0;
      run.nextShip = .18;
      run.remaining = run.wave % 4 === 0 ? 1 : Math.min(25, 8 + run.wave * 2);
      effects.announce(run.wave % 4 === 0 ? 'В сектор вошёл флагман.' : `Волна ${run.wave}`);
    }
  }
  for (const enemy of run.enemies) {
    if (enemy.boss) {
      enemy.y = Math.min(68, enemy.y + dt * 42);
      enemy.x = WIDTH / 2 + Math.sin(run.time * .91) * 129;
    } else {
      enemy.y += dt * (enemy.kind.speed + Math.min(run.wave * 2.5, 38));
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
      enemy.hp--;
      if (enemy.hp > 0) continue;
      run.score += enemy.kind.score;
      run.kills++;
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
    if (bonus.y > HEIGHT + 11 || (overlaps(player, bonus) && player.hull > 0)) {
      bonus.dead = true;
      if (bonus.y > HEIGHT + 11) continue;
      if (bonus.type === 'spread') player.spread = 10;
      if (bonus.type === 'shield') player.shield = true;
      if (bonus.type === 'repair') player.hull = Math.min(3, player.hull + 1);
      effects.announce(BONUSES[bonus.type].label);
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

function galaxyRenderer(canvas, motion) {
  const ctx = canvas.getContext('2d');
  const backdrop = ctx.createRadialGradient(335, 138, 12, 345, 140, 383);
  backdrop.addColorStop(0, '#292344');
  backdrop.addColorStop(.48, '#111d38');
  backdrop.addColorStop(1, '#080b1c');
  const planet = ctx.createRadialGradient(374, 84, 2, 402, 113, 78);
  planet.addColorStop(0, '#7263a2');
  planet.addColorStop(.55, '#393258');
  planet.addColorStop(1, '#19162e');
  const stars = Array.from({length:82}, (_, index) => ({
    x:(index * 131 + 19) % WIDTH, y:(index * 89 + 37) % HEIGHT, layer:index % 3, size:index % 8 === 0 ? 2 : 1,
  }));
  const ship = ['.....2.....','.....2.....','....121....','....131....','2...131...2','21.11311.12','21111111112','22211111222','..2.1.1.2..'];
  return function draw(run) {
    ctx.fillStyle = backdrop;
    ctx.fillRect(0,0,WIDTH,HEIGHT);
    ctx.fillStyle = planet;
    ctx.beginPath();
    ctx.arc(407,109,63,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = '#9b8dc641';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(404,114,92,15,-.34,0,Math.PI*2);
    ctx.stroke();
    for (const {x,y,layer,size} of stars) {
      ctx.fillStyle = ['#697595','#b2b8d8','#c8ecfa'][layer];
      const shift = motion.matches ? 0 : run.time * (15 + layer * 15);
      ctx.fillRect(x, (y + shift) % HEIGHT, size, size);
    }
    for (const enemy of run.enemies) {
      const {kind,x,y} = enemy;
      sprite(ctx,kind.sprite,x,y,enemy.boss ? 5 : 3,{1:kind.color,2:kind.light});
      if (enemy.boss) {
        ctx.fillStyle = '#13152d';
        ctx.fillRect(x-45,y-28,90,4);
        ctx.fillStyle = kind.color;
        ctx.fillRect(x-45,y-28,90 * enemy.hp / enemy.maxHp,4);
      }
    }
    for (const laser of run.lasers) {
      ctx.fillStyle = '#62f7d5';
      ctx.fillRect(laser.x-2,laser.y-9,4,12);
      ctx.fillStyle = '#d5fff1';
      ctx.fillRect(laser.x-1,laser.y-10,2,8);
    }
    for (const shot of run.fire) {
      ctx.fillStyle = '#ff5982';
      ctx.fillRect(shot.x-3,shot.y-3,6,6);
      ctx.fillStyle = '#ffc6d1';
      ctx.fillRect(shot.x-1,shot.y-1,2,2);
    }
    for (const bonus of run.bonuses) {
      const {color,symbol} = BONUSES[bonus.type];
      ctx.fillStyle = '#131b36';
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
      sprite(ctx,ship,x,y,3,{1:'#59dec8',2:'#c1fff1',3:'#658dff'});
      ctx.fillStyle = '#84d6ff';
      ctx.fillRect(x-3,y+13,6,5);
      ctx.fillStyle = '#6777ff';
      ctx.fillRect(x-2,y+18,4,4 + (motion.matches ? 0 : Math.sin(run.time*30)*2));
      if (player.shield) {
        ctx.beginPath();
        ctx.strokeStyle = '#76e8f2';
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
  };
}

export function galaxyGame(root, win) {
  const controller = new AbortController();
  const {signal} = controller;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  root.classList.add('galaxy-content');
  root.innerHTML = `
    <section class="galaxy-cabinet" aria-label="Галактика">
      <header class="galaxy-header">
        <div><small>GREENOS ARCADE · 06</small><h2>Галактика</h2></div>
        <button class="galaxy-sound" type="button" aria-pressed="false">Звук выкл.</button>
        <button class="galaxy-pause" type="button" disabled>Пауза</button>
      </header>
      <div class="galaxy-hud">
        <div><span>СЧЁТ</span><strong data-stat="score"></strong></div>
        <div><span>РЕКОРД</span><strong data-stat="best"></strong></div>
        <div><span>ВОЛНА</span><strong data-stat="wave"></strong></div>
        <div><span>КОРПУС</span><strong data-stat="hull"></strong></div>
      </div>
      <div class="galaxy-stage">
        <canvas width="${WIDTH}" height="${HEIGHT}" tabindex="0" aria-label="Игровое поле. Стрелки или WASD — движение, пробел — стрельба"></canvas>
        <div class="galaxy-overlay">
          <div class="galaxy-message">
            <span class="galaxy-kicker">ОРБИТАЛЬНЫЙ ПАТРУЛЬ</span>
            <strong class="galaxy-title">Сектор Ω</strong>
            <p class="galaxy-summary">Уклоняйтесь от залпов и сбивайте корабли. Каждая четвёртая волна — флагман.</p>
            <button class="galaxy-action" type="button">Начать полёт</button>
          </div>
        </div>
      </div>
      <p class="galaxy-status" role="status">Готов к вылету</p>
      <p class="galaxy-help"><kbd>WASD</kbd> / <kbd>↑←↓→</kbd> движение · <kbd>Пробел</kbd> огонь · <kbd>P</kbd> пауза<br>Мышь или палец на поле — движение и огонь</p>
    </section>`;
  const canvas = $('canvas',root);
  const draw = galaxyRenderer(canvas,motion);
  const overlay = $('.galaxy-overlay',root);
  const title = $('.galaxy-title',root);
  const summary = $('.galaxy-summary',root);
  const action = $('.galaxy-action',root);
  const pauseButton = $('.galaxy-pause',root);
  const soundButton = $('.galaxy-sound',root);
  const status = $('.galaxy-status',root);
  const stats = Object.fromEntries([...root.querySelectorAll('[data-stat]')].map(node => [node.dataset.stat,node]));
  const keys = new Set();
  const controls = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Space']);
  let best = bestScore(), run = createRun(), phase = 'ready', target, pointerId;
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
    const stored = bestScore();
    best = Math.max(best, run.score, stored);
    if (best > stored) {
      try { localStorage.setItem(BEST_KEY,String(best)); } catch { /* The current record remains visible. */ }
    }
  }
  function render() {
    best = Math.max(best, run.score);
    const values = {score:String(run.score).padStart(5,'0'), best:String(best).padStart(5,'0'),
      wave:String(run.wave).padStart(2,'0'), hull:`${run.player.hull}/3${run.player.shield ? ' ◈' : ''}`};
    for (const [name,value] of Object.entries(values)) if (stats[name].textContent !== value) stats[name].textContent = value;
    draw(run);
  }
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
    overlay.hidden = false;
    pauseButton.disabled = true;
    announce(heading);
  }
  function pause(message = 'Продолжите полёт, когда будете готовы.') {
    if (phase === 'running') stop('paused','Пауза',message,'Продолжить');
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
    if (run.player.hull <= 0) {
      stop('over','Корабль потерян',`Счёт ${run.score} · волна ${run.wave} · рекорд ${best}`,'Новый полёт');
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  action.onclick = () => {
    if (!active() || phase === 'running') return;
    if (phase !== 'paused') {
      run = createRun();
      announce('Волна 1');
    } else announce(`Волна ${run.wave} · полёт продолжен`);
    phase = 'running';
    previous = undefined;
    overlay.hidden = true;
    pauseButton.disabled = false;
    canvas.focus({preventScroll:true});
    frame = requestAnimationFrame(tick);
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
  render();
  return () => {
    cancelAnimationFrame(frame);
    saveRecord();
    clearInput();
    controller.abort();
    audio?.close().catch(() => {});
    root.classList.remove('galaxy-content');
  };
}
