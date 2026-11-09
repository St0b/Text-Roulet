import {$, el, ask, on} from './core.js';
import {wm} from './windows.js';
import {BLOCK, BUILD_BLOCKS, DEFAULT_SEED, EYE_HEIGHT, HEIGHT, PLACEABLE_BLOCKS, World,
  direction, indexOf, isSolid, isWheat, movePlayer, overlapsPlayer, raycast} from './blocks/world.js';
import {Renderer} from './blocks/renderer.js';
import {CHAPTERS, Expedition, TOOLS, miningRule} from './blocks/expedition.js';
import {ITEM, itemName} from './blocks/items.js';
import {createExpeditionPanel, itemSwatch, updateSwatch} from './blocks/expedition-panel.js';
import {MAX_BREATH, MAX_VITAL, MOBS, Survival, isFood} from './blocks/survival.js';
import {isNight, skyLight} from './blocks/lighting.js';
import {Farm} from './blocks/farming.js';

const MODES = {
  expedition: {name: 'Экспедиция', key: 'greenos-greenblocks-expedition-v1'},
  creative: {name: 'Творческий', key: 'greenos-greenblocks-v1'},
};
const MODE_KEY = 'greenos-greenblocks-mode';
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight']);
const PITCH_LIMIT = Math.PI / 2 - .01;

function loadSave(key) {
  let raw = null;
  try {
    raw = localStorage.getItem(key);
    const data = JSON.parse(raw);
    if (data?.version === 1 && Number.isInteger(data.seed) && Array.isArray(data.edits)) return {raw, data};
  } catch { /* A blocked storage or an invalid save still allows a new world. */ }
  return {raw, data: null};
}

function preferredMode() {
  try {
    if (localStorage.getItem(MODE_KEY) === 'creative') return 'creative';
  } catch { /* The default mode also works without storage. */ }
  return 'expedition';
}

function makePlayer(world, saved) {
  const valid = saved && ['x', 'y', 'z', 'yaw', 'pitch'].every(key => Number.isFinite(saved[key]))
    && saved.y >= 0 && saved.y <= HEIGHT + 12 && !world.collides(saved);
  const {x, y, z, yaw, pitch} = valid ? saved : world.spawn();
  return {x, y, z, yaw, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)),
    flying: Boolean(valid && saved.flying), velocity: 0, grounded: false};
}

export const blocksApp = {
  id: 'blocks', name: 'GreenBlocks', subtitle: 'Воксельная экспедиция и строительство', keywords: 'minecraft блоки строительство',
  icon: 'games', singleton: true, width: 1040, height: 700,

  mount(win) {
    let gameMode = preferredMode();
    let savedRaw, world, player, progress, survival, farm, selectedSlot;
    let growthTime = 0;
    let unsaved = false;
    function loadWorld(data) {
      const expedition = gameMode === 'expedition';
      world = new World(data?.seed ?? DEFAULT_SEED, data?.edits, expedition);
      progress = expedition ? new Expedition(data?.progress, world, data?.material) : null;
      survival = expedition ? new Survival(data?.survival) : null;
      farm = expedition ? new Farm(world, data?.farm) : null;
      growthTime = 0;
      progress?.advance(world);
      player = makePlayer(world, data?.player);
      if (progress && !progress.flightUnlocked) player.flying = false;
      const bar = progress?.hotbar ?? BUILD_BLOCKS;
      selectedSlot = progress && Number.isInteger(data?.slot) && data.slot >= 0 && data.slot < bar.length
        ? data.slot : Math.max(0, bar.indexOf(data?.material));
    }
    const initial = loadSave(MODES[gameMode].key);
    savedRaw = initial.raw;
    loadWorld(initial.data);
    let mode = 'paused';
    let mining = null;
    let pointerPending = false;
    let frame = 0;
    let previousTime = 0;
    let lastForwardPress = -Infinity;
    let sprinting = false;
    let drag = null;
    const keys = new Set();
    const signal = win.abort.signal;

    win.body.classList.add('blocks-window');
    win.body.innerHTML = `
      <div class="blocks-stage">
        <canvas class="blocks-canvas" tabindex="0" aria-label="Игровой мир GreenBlocks"></canvas>
        <div class="blocks-hud">
          <span class="blocks-chip blocks-seed"></span><span class="blocks-chip blocks-mode"></span>
        </div>
        <div class="blocks-objective" hidden></div>
        <div class="blocks-survival" hidden>
          <div class="blocks-survival-row">
            <label class="blocks-vital blocks-health"><span>❤</span><progress max="20" aria-label="Здоровье"></progress><strong></strong></label>
            <span class="blocks-time"></span>
            <label class="blocks-vital blocks-hunger"><span>◆</span><progress max="20" aria-label="Сытость"></progress><strong></strong></label>
          </div>
          <label class="blocks-vital blocks-breath" hidden><span>◌</span><progress max="10" aria-label="Воздух"></progress><strong></strong></label>
        </div>
        <div class="blocks-crosshair" aria-hidden="true" hidden></div>
        <span class="blocks-use-hint" hidden></span>
        <progress class="blocks-mining" max="1" value="0" aria-label="Добыча блока" hidden></progress>
        <div class="blocks-inventory" aria-label="Панель блоков"></div>
        <div class="blocks-pause">
          <div class="blocks-card">
            <span class="blocks-eyebrow">GREENOS GAMES</span>
            <h2>Green<span>Blocks</span></h2>
            <div class="blocks-mode-picker" aria-label="Режим игры">
              <button type="button" data-block-mode="expedition">Экспедиция</button>
              <button type="button" data-block-mode="creative">Творческий</button>
            </div>
            <p class="blocks-intro"></p>
            <div class="blocks-controls" aria-label="Управление">
              <span><kbd>W A S D</kbd> Ходьба</span><span><kbd>Пробел</kbd> Прыжок</span>
              <span><kbd>ЛКМ</kbd> Добыть</span><span><kbd>ПКМ</kbd> Поставить</span>
              <span class="blocks-hotbar-control"></span><span class="blocks-context-control"></span>
            </div>
            <label class="blocks-difficulty" hidden>Сложность <select aria-label="Сложность экспедиции">
              <option value="normal">Обычная</option><option value="peaceful">Мирная</option>
            </select></label>
            <div class="blocks-actions">
              <button class="primary blocks-play" type="button">Играть</button>
              <button class="blocks-open-workshop" type="button">Инвентарь</button>
              <button class="blocks-home" type="button">К старту</button>
              <button class="blocks-new" type="button">Новый мир</button>
            </div>
          </div>
        </div>
        <div class="blocks-death" hidden>
          <div class="blocks-card">
            <span class="blocks-eyebrow">ЭКСПЕДИЦИЯ</span>
            <h2>Ты погиб</h2>
            <p class="blocks-death-cause"></p>
            <p>Вещи останутся в сундуке на месте гибели. Вернись туда, чтобы их забрать.</p>
            <button type="button" class="primary blocks-respawn">Возродиться</button>
          </div>
        </div>
        <div class="blocks-workshop" aria-label="Инвентарь и станции экспедиции" hidden>
          <div class="blocks-workshop-header">
            <div><span class="blocks-eyebrow">ЭКСПЕДИЦИЯ</span><h2 class="blocks-panel-title"></h2></div>
            <div class="blocks-workshop-actions">
              <button class="blocks-back-pause" type="button">Пауза</button>
              <button class="primary blocks-resume" type="button">В мир</button>
            </div>
          </div>
          <div class="blocks-workshop-layout">
            <section class="blocks-journal-panel" aria-label="Журнал экспедиции">
              <h3>Журнал экспедиции</h3>
              <ol class="blocks-journal"></ol>
              <ul class="blocks-tasks"></ul>
              <p class="blocks-journal-hint"></p>
            </section>
            <div class="blocks-workshop-content">
              <section class="blocks-crafting" aria-label="Крафт">
                <h3 class="blocks-craft-title"></h3>
                <div class="blocks-craft-row">
                  <div class="blocks-craft-grid" aria-label="Сетка крафта"></div>
                  <span class="blocks-craft-arrow" aria-hidden="true">➜</span>
                  <button class="blocks-craft-result" type="button" data-cell="result"></button>
                </div>
                <p class="blocks-craft-status"></p>
                <div class="blocks-recipe-header"><strong>Схемы</strong><button class="blocks-craft-clear" type="button">Очистить сетку</button></div>
                <div class="blocks-recipes" aria-label="Схемы крафта"></div>
              </section>
              <section class="blocks-furnace-panel" aria-label="Плавка" hidden>
                <h3>Плавка</h3>
                <div class="blocks-furnace-slots"></div>
                <div class="blocks-furnace-meters">
                  <label>Жар <progress class="blocks-heat" max="1" value="0"></progress></label>
                  <label>Плавка <progress class="blocks-smelt" max="1" value="0"></progress></label>
                </div>
                <p class="blocks-furnace-status" role="status"></p>
                <p class="blocks-panel-tip">Печь плавит руду, жарит мясо и обжигает песок. Она работает и после закрытия этого экрана.</p>
              </section>
              <section aria-label="Рюкзак и быстрая панель">
                <h3>Рюкзак <span class="blocks-tool"></span></h3>
                <div class="blocks-pack"></div>
                <p class="blocks-picked" aria-live="polite"></p>
                <h3>Быстрая панель <span class="blocks-tool">1–9</span></h3>
                <div class="blocks-panel-bar" aria-label="Быстрая панель"></div>
                <p class="blocks-panel-tip">Перетащи предмет в ячейку или выбери его двумя щелчками. ПКМ по ячейке возвращает стопку в рюкзак.</p>
              </section>
            </div>
          </div>
        </div>
      </div>
      <footer class="statusbar blocks-statusbar">
        <span class="blocks-material"></span><span class="blocks-coordinates"></span>
        <span class="spacer"></span><span class="blocks-save" role="status"></span>
      </footer>`;

    const q = selector => $(selector, win.body);
    const stage = q('.blocks-stage');
    const canvas = q('.blocks-canvas');
    const pausePanel = q('.blocks-pause');
    const workshop = q('.blocks-workshop');
    const objective = q('.blocks-objective');
    const miningMeter = q('.blocks-mining');
    const crosshair = q('.blocks-crosshair');
    const deathPanel = q('.blocks-death');
    const vitals = q('.blocks-survival');
    const difficulty = q('.blocks-difficulty select');
    const useHint = q('.blocks-use-hint');
    const play = q('.blocks-play');
    const saveStatus = q('.blocks-save');
    let renderer = new Renderer(canvas, world);
    const hotbar = () => progress?.hotbar ?? BUILD_BLOCKS;
    const selectedItem = () => hotbar()[selectedSlot];
    const inventoryBar = q('.blocks-inventory');
    const panel = createExpeditionPanel(workshop, {changed: afterProgress});

    function buildHotbar() {
      inventoryBar.replaceChildren(...hotbar().map((id, index) => {
        return el('button', {class: 'blocks-slot', type: 'button', onclick: () => select(index)},
          itemSwatch(id), el('small', {}, String(index + 1)), el('b', {class: 'blocks-stock'}));
      }));
      updateHotbar();
    }

    function select(index) {
      if (index !== selectedSlot) unsaved = true;
      selectedSlot = index;
      updateHotbar();
    }

    function updateHotbar() {
      for (const [index, slot] of [...inventoryBar.children].entries()) {
        const id = hotbar()[index];
        const stock = progress?.count(id);
        const label = `${index + 1}. ${itemName(id)}${stock ? ` ×${stock}` : ''}`;
        slot.setAttribute('aria-pressed', String(index === selectedSlot));
        slot.setAttribute('aria-label', label);
        slot.title = label;
        updateSwatch(slot.querySelector('.blocks-swatch'), id);
        slot.querySelector('.blocks-stock').textContent = stock || '';
      }
      const id = selectedItem();
      q('.blocks-material').textContent = progress
        ? `${itemName(id)}${id == null ? '' : ` ×${progress.count(id)}`} · ${TOOLS[progress.tool]}`
        : itemName(id);
    }

    function save() {
      const key = MODES[gameMode].key;
      try {
        if (localStorage.getItem(key) !== savedRaw) {
          saveStatus.textContent = 'Мир изменён в другой вкладке';
          return false;
        }
        const {x, y, z, yaw, pitch, flying} = player;
        const snapshot = JSON.stringify({version: 1, seed: world.seed, edits: [...world.edits],
          player: {x, y, z, yaw, pitch, flying}, material: selectedItem(), slot: progress ? selectedSlot : undefined,
          progress: progress ?? undefined, survival: survival ?? undefined, farm: farm ?? undefined});
        if (snapshot !== savedRaw) localStorage.setItem(key, snapshot);
        savedRaw = snapshot;
        unsaved = false;
        saveStatus.textContent = 'Мир сохранён';
        return true;
      } catch {
        saveStatus.textContent = 'Не удалось сохранить мир';
        return false;
      }
    }

    function targetBlock() {
      return raycast(world, [player.x, player.y + EYE_HEIGHT, player.z], direction(player.yaw, player.pitch));
    }

    function draw(hit = null) {
      if (!renderer || win.element.hidden) return;
      renderer.draw(player, hit, survival);
      const darkness = survival ? ((1 - skyLight(survival.phase)) / .73).toFixed(2) : '0';
      if (stage.style.getPropertyValue('--night') !== darkness) stage.style.setProperty('--night', darkness);
      const station = progress && (hit?.material === BLOCK.workbench || hit?.material === BLOCK.furnace);
      const mob = mode === 'paused' ? null : survival?.targetMob(player, hit);
      const hint = mob ? `ЛКМ · ${MOBS[mob.kind].name} ${Math.ceil(mob.health)}/${MOBS[mob.kind].health}`
        : station ? `ПКМ · ${itemName(hit.material)}`
          : mode !== 'paused' && survival && isFood(selectedItem()) ? 'ПКМ · Съесть' : '';
      useHint.hidden = !hint;
      if (hint) {
        if (useHint.textContent !== hint) useHint.textContent = hint;
      }
      const coordinates = `${Math.floor(player.x)} / ${Math.floor(player.y)} / ${Math.floor(player.z)}`;
      const positionLabel = q('.blocks-coordinates');
      if (positionLabel.textContent !== coordinates) positionLabel.textContent = coordinates;
    }

    function updateHud() {
      q('.blocks-seed').textContent = `МИР ${world.seed.toString(16).toUpperCase().padStart(8, '0')}`;
      q('.blocks-mode').textContent = progress && !progress.flightUnlocked ? 'ИНВЕНТАРЬ · E'
        : player.flying ? 'ПОЛЁТ · F' : 'ПЕШКОМ · F';
      objective.hidden = !progress || mode === 'paused';
      if (progress) objective.textContent = progress.flightUnlocked ? '✓ Экспедиция завершена'
        : `${progress.chapter + 1}/${CHAPTERS.length} · ${CHAPTERS[progress.chapter].name}`;
      updateVitals();
    }

    const healthMeter = q('.blocks-health progress');
    const hungerMeter = q('.blocks-hunger progress');
    const breathMeter = q('.blocks-breath progress');
    const timeLabel = q('.blocks-time');

    function setMeter(meter, value, max) {
      const rounded = Math.ceil(value);
      if (meter.value === rounded && meter.nextElementSibling.textContent) return;
      meter.value = rounded;
      meter.nextElementSibling.textContent = `${rounded}/${max}`;
    }

    function updateVitals() {
      vitals.hidden = !survival || mode === 'paused';
      if (!survival) return;
      setMeter(healthMeter, survival.health, MAX_VITAL);
      setMeter(hungerMeter, survival.food, MAX_VITAL);
      setMeter(breathMeter, survival.breath, MAX_BREATH);
      breathMeter.parentElement.hidden = survival.breath >= MAX_BREATH;
      const phase = isNight(survival.phase) ? 'НОЧЬ' : survival.phase >= .57 && survival.phase < .67 ? 'СУМЕРКИ' : 'ДЕНЬ';
      const label = `${phase} ${survival.day}`;
      if (timeLabel.textContent !== label) timeLabel.textContent = label;
    }

    function updatePause(hasSave) {
      for (const button of pausePanel.querySelectorAll('[data-block-mode]')) {
        button.setAttribute('aria-pressed', String(button.dataset.blockMode === gameMode));
      }
      q('.blocks-intro').textContent = progress
        ? 'Добудь ресурсы, переживи ночь и построй поселение. Маяк завершит экспедицию и откроет полёт.'
        : 'Строй из восьми материалов с бесконечным запасом и свободным полётом. У этого мира своё сохранение.';
      q('.blocks-hotbar-control').replaceChildren(el('kbd', {}, progress ? '1–9' : '1–8'), ' Быстрая панель');
      q('.blocks-context-control').replaceChildren(el('kbd', {}, progress ? 'E' : 'F'), progress ? ' Инвентарь' : ' Полёт');
      q('.blocks-open-workshop').hidden = !progress;
      difficulty.parentElement.hidden = !survival;
      if (survival) difficulty.value = survival.difficulty;
      play.textContent = hasSave ? 'Продолжить' : 'Играть';
    }

    function stopMining() {
      mining = null;
      miningMeter.hidden = true;
    }

    function updateMining(hit, dt) {
      if (!mining) return;
      if (!hit || !hit.cell.every((value, index) => value === mining.cell[index]) || hit.material !== mining.block) {
        stopMining();
        return;
      }
      mining.elapsed += dt;
      miningMeter.value = mining.elapsed / mining.seconds;
      if (mining.elapsed < mining.seconds) return;
      const {cell, item, block} = mining;
      const index = indexOf(...cell);
      const natural = world.base[index] === block && !world.edits.has(index);
      const apple = block === BLOCK.leaves && natural && Math.random() < .12;
      const seed = block === BLOCK.grass && natural && Math.random() < .35;
      stopMining();
      changeBlock(cell, BLOCK.air, () => {
        if (block === BLOCK.furnace) progress.removeFurnace(index);
        progress.collect(item);
        if (apple) progress.deposit(ITEM.apple, 1);
        if (seed) progress.deposit(ITEM.seed, 1);
        if (isWheat(block)) farm.remove(cell);
        if (block === BLOCK.wheatRipe) {
          progress.deposit(ITEM.wheat, 1);
          progress.deposit(ITEM.seed, 1);
        }
        if (isSolid(block)) {
          const [x, y, z] = cell;
          const above = [x, y + 1, z];
          const id = world.get(...above);
          if (id === BLOCK.torch && world.set(...above, BLOCK.air)) progress.deposit(BLOCK.torch, 1);
          if (isWheat(id) && world.set(...above, BLOCK.air)) {
            farm.remove(above);
            progress.deposit(ITEM.seed, id === BLOCK.wheatRipe ? 2 : 1);
            if (id === BLOCK.wheatRipe) progress.deposit(ITEM.wheat, 1);
          }
        }
      }, apple ? 'Из листвы выпало яблоко' : seed ? 'Найдены семена пшеницы'
        : block === BLOCK.wheatRipe ? 'Собрана пшеница' : `Добыто · ${itemName(item)}`);
    }

    function tick(time) {
      if (mode === 'paused') return;
      const dt = previousTime ? Math.min(.05, (time - previousTime) / 1000) : 0;
      previousTime = time;
      const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      const strafe = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const jump = keys.has('Space');
      const vertical = Number(jump) - Number(keys.has('ShiftLeft') || keys.has('ShiftRight'));
      const sprint = Boolean(survival && sprinting && forward > 0 && survival.food > 6 && !player.flying);
      const impact = movePlayer(world, player, {forward, strafe, jump, vertical, sprint}, dt);
      const hit = targetBlock();
      if (survival) {
        const message = survival.tick(dt, world, player, progress, {moving: forward || strafe, sprint,
          impact, levels: renderer.levels});
        if (survival.dead) {
          q('.blocks-death-cause').textContent = message;
          pause();
          q('.blocks-respawn').focus({preventScroll: true});
          return;
        }
        if (message) afterProgress(message);
        else updateVitals();
        growthTime += dt;
        if (growthTime >= .5) {
          const updates = farm.tick(growthTime, world, skyLight(survival.phase), renderer.levels);
          growthTime = 0;
          if (updates.length) {
            renderer.updatePlants(updates);
            unsaved = true;
            save();
          }
        }
      }
      updateMining(hit, dt);
      draw(hit);
      frame = requestAnimationFrame(tick);
    }

    function pause() {
      const wasPlaying = mode !== 'paused';
      mode = 'paused';
      pointerPending = false;
      keys.clear();
      sprinting = false;
      lastForwardPress = -Infinity;
      drag = null;
      stopMining();
      cancelAnimationFrame(frame);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      deathPanel.hidden = !survival?.dead;
      pausePanel.hidden = !deathPanel.hidden;
      workshop.hidden = true;
      crosshair.hidden = true;
      useHint.hidden = true;
      inventoryBar.inert = true;
      updateHud();
      if (wasPlaying) {
        play.textContent = 'Продолжить';
        save();
        draw();
      }
    }

    function start(nextMode) {
      pointerPending = false;
      if (signal.aborted || win.minimized || win.element.hidden || wm.active !== win || !renderer) {
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        return;
      }
      mode = nextMode;
      unsaved = true;
      pausePanel.hidden = true;
      workshop.hidden = true;
      crosshair.hidden = false;
      inventoryBar.inert = false;
      updateHud();
      saveStatus.textContent = nextMode === 'drag' ? 'Потяни мышь для обзора · Esc пауза' : 'Esc — пауза';
      previousTime = 0;
      frame = requestAnimationFrame(tick);
    }

    function fallback() { if (pointerPending) start('drag'); }

    function requestPlay() {
      if (pointerPending || mode !== 'paused' || !renderer || survival?.dead) return;
      wm.focus(win);
      canvas.focus();
      if (!canvas.requestPointerLock) { start('drag'); return; }
      pointerPending = true;
      try { canvas.requestPointerLock()?.catch(fallback); } catch { fallback(); }
    }
    play.onclick = requestPlay;
    q('.blocks-resume').onclick = requestPlay;

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        if (pointerPending) start('pointer');
        else document.exitPointerLock();
      }
      else if (mode === 'pointer') pause();
    }, {signal});
    document.addEventListener('pointerlockerror', fallback, {signal});

    function look(dx, dy) {
      player.yaw = (player.yaw + dx * .0026) % (Math.PI * 2);
      player.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, player.pitch - dy * .0026));
    }

    function afterProgress(message) {
      unsaved = true;
      const chapter = progress?.chapter;
      progress?.advance(world);
      updateHotbar();
      updateHud();
      if (!save()) return;
      if (chapter !== progress?.chapter) {
        saveStatus.textContent = progress.flightUnlocked ? 'Экспедиция завершена · полёт открыт'
          : `Новый этап · ${CHAPTERS[progress.chapter].name}`;
      } else if (message) saveStatus.textContent = message;
    }

    function changeBlock([x, y, z], material, account, message) {
      if (!world.set(x, y, z, material)) return;
      account?.();
      renderer.updateBlock(x, y, z);
      afterProgress(message);
    }

    function edit(place, sneaking) {
      const hit = targetBlock();
      const selected = selectedItem();
      if (survival && !place) {
        const mob = survival.targetMob(player, hit);
        if (mob) {
          stopMining();
          const message = survival.attack(mob, selected, progress);
          if (message) afterProgress(message);
          return;
        }
      }
      if (progress && place && !sneaking) {
        if (hit?.material === BLOCK.workbench) { openPanel('workbench'); return; }
        if (hit?.material === BLOCK.furnace) { openPanel('furnace', indexOf(...hit.cell)); return; }
      }
      if (survival && place && isFood(selected)) {
        if (survival.eat(selected, progress)) afterProgress(`Съедено · ${itemName(selected)}`);
        else saveStatus.textContent = 'Сытость полная';
        return;
      }
      if (!hit) return;
      if (survival && place && selected === ITEM.woodHoe) {
        const [x, y, z] = hit.cell;
        if ([BLOCK.grass, BLOCK.dirt].includes(hit.material) && world.get(x, y + 1, z) === BLOCK.air) {
          changeBlock(hit.cell, BLOCK.farmland, null, 'Грядка готова · посади семена');
        } else saveStatus.textContent = 'Для грядки нужна открытая земля';
        return;
      }
      if (survival && place && selected === ITEM.seed) {
        const [x, y, z] = hit.cell;
        if (hit.material === BLOCK.farmland && world.get(x, y + 1, z) === BLOCK.air) {
          const cell = [x, y + 1, z];
          changeBlock(cell, BLOCK.wheatSeedling, () => {
            progress.withdraw(ITEM.seed, 1);
            farm.plant(cell);
          }, 'Пшеница посажена');
        } else saveStatus.textContent = 'Семена можно посадить на пустую грядку';
        return;
      }
      const position = place ? hit.adjacent : hit.cell;
      if (!position || (place && overlapsPlayer(player, position))) return;
      if (!progress) {
        changeBlock(position, place ? selected : BLOCK.air);
      } else if (place) {
        if (!PLACEABLE_BLOCKS.includes(selected)) {
          saveStatus.textContent = selected == null ? 'Положи блок на быструю панель · E' : 'Этот предмет нельзя поставить';
          return;
        }
        if (selected === BLOCK.torch && !isSolid(world.get(position[0], position[1] - 1, position[2]))) {
          saveStatus.textContent = 'Факелу нужна опора снизу';
          return;
        }
        stopMining();
        changeBlock(position, selected, () => progress.withdraw(selected, 1));
      } else {
        if (mining?.cell.every((value, index) => value === position[index])) return;
        stopMining();
        const rule = miningRule(hit.material, progress.tool);
        if (rule.message) {
          saveStatus.textContent = rule.message;
          return;
        }
        mining = {...rule, cell: position, block: hit.material, elapsed: 0};
        miningMeter.value = 0;
        miningMeter.hidden = false;
      }
    }

    function openPanel(kind, index) {
      if (!progress || pointerPending || survival?.dead) return;
      pause();
      pausePanel.hidden = true;
      panel.open(kind, progress, world, index);
      q('.blocks-resume').focus({preventScroll: true});
    }
    q('.blocks-open-workshop').onclick = () => openPanel('inventory');
    q('.blocks-back-pause').onclick = () => {
      pause();
      q('.blocks-open-workshop').focus({preventScroll: true});
    };

    document.addEventListener('mousemove', event => {
      if (mode === 'pointer') look(event.movementX, event.movementY);
    }, {signal});
    canvas.addEventListener('pointerdown', event => {
      if (mode === 'pointer') {
        if (event.button === 0 || event.button === 2) edit(event.button === 2, event.shiftKey);
      } else if (mode === 'drag') {
        if (event.button === 2) edit(true, event.shiftKey);
        if (event.button !== 0) return;
        drag = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false};
        canvas.setPointerCapture(event.pointerId);
      }
    }, {signal});
    canvas.addEventListener('pointermove', event => {
      if (mode !== 'drag' || drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      look(dx, dy);
      drag = {...drag, x: event.clientX, y: event.clientY, moved: true};
    }, {signal});
    canvas.addEventListener('pointerup', event => {
      if (mode !== 'drag' || drag?.id !== event.pointerId) return;
      if (!drag.moved) edit(false);
      drag = null;
    }, {signal});
    canvas.addEventListener('lostpointercapture', () => { drag = null; }, {signal});
    canvas.addEventListener('contextmenu', event => { if (mode !== 'paused') event.preventDefault(); }, {signal});
    canvas.addEventListener('wheel', event => {
      if (mode === 'paused') return;
      event.preventDefault();
      const count = hotbar().length;
      if (event.deltaY) select((selectedSlot + Math.sign(event.deltaY) + count) % count);
    }, {passive: false, signal});

    document.addEventListener('keydown', event => {
      const {code} = event;
      if (event.ctrlKey || event.altKey || event.metaKey || wm.active !== win || win.minimized
        || $('#system-dialog')?.open || survival?.dead) return;
      if (code === 'KeyE' && progress && !event.repeat) {
        event.preventDefault();
        if (workshop.hidden) openPanel('inventory');
        else requestPlay();
        return;
      }
      if (!workshop.hidden && code === 'Escape') {
        q('.blocks-back-pause').click();
        return;
      }
      if (mode === 'paused') return;
      if (MOVE_KEYS.has(code)) {
        event.preventDefault();
        if (code === 'KeyW' && !event.repeat) {
          const now = performance.now();
          sprinting = now - lastForwardPress < 290;
          lastForwardPress = now;
        }
        keys.add(code);
      } else if (code === 'Escape') {
        pause();
      } else if (code === 'KeyF' && !event.repeat) {
        if (progress && !progress.flightUnlocked) {
          saveStatus.textContent = 'Маяк экспедиции откроет полёт';
          return;
        }
        player.flying = !player.flying;
        player.velocity = 0;
        player.grounded = false;
        updateHud();
      } else if (/^Digit[1-9]$/.test(code)) {
        const index = Number(code.at(-1)) - 1;
        if (index < hotbar().length) select(index);
      }
    }, {signal});
    document.addEventListener('keyup', event => {
      keys.delete(event.code);
      if (event.code === 'KeyW') sprinting = false;
    }, {signal});
    window.addEventListener('blur', pause, {signal});
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); }, {signal});
    window.addEventListener('pagehide', () => { pause(); save(); }, {signal});
    on('focus', active => { if (active !== win) pause(); }, signal);
    on('lock', locked => { if (locked) pause(); }, signal);

    q('.blocks-home').onclick = () => {
      player = makePlayer(world);
      unsaved = true;
      updateHud();
      save();
      draw();
    };
    difficulty.onchange = () => {
      if (!survival) return;
      survival.setDifficulty(difficulty.value);
      afterProgress();
      draw();
    };
    q('.blocks-respawn').onclick = () => {
      if (!survival?.dead) return;
      survival.respawn(player, progress);
      player = makePlayer(world);
      afterProgress('Возрождение · вещи остались на месте гибели');
      pause();
      draw();
      play.focus({preventScroll: true});
    };
    for (const button of pausePanel.querySelectorAll('[data-block-mode]')) {
      button.onclick = () => {
        const nextMode = button.dataset.blockMode;
        if (nextMode === gameMode || pointerPending || (unsaved && !save())) return;
        gameMode = nextMode;
        const {raw, data} = loadSave(MODES[gameMode].key);
        savedRaw = raw;
        loadWorld(data);
        try { localStorage.setItem(MODE_KEY, gameMode); } catch { /* The active mode remains usable. */ }
        showWorld(data);
      };
    }
    q('.blocks-new').onclick = async () => {
      const name = MODES[gameMode].name;
      const confirmed = await ask('Создать новый мир?', {
        message: `Мир режима «${name}» и его прогресс будут заменены новым миром.`, confirm: true, ok: 'Создать мир',
      });
      if (!confirmed || signal.aborted) return;
      loadWorld({seed: crypto.getRandomValues(new Uint32Array(1))[0]});
      unsaved = true;
      showWorld(null);
      save();
    };

    function showWorld(data) {
      deathPanel.hidden = !survival?.dead;
      pausePanel.hidden = !deathPanel.hidden;
      q('.blocks-death-cause').textContent = '';
      if (renderer && renderer.world !== world) renderer.rebuild(world);
      buildHotbar();
      updatePause(Boolean(data));
      updateHud();
      saveStatus.textContent = data ? 'Мир загружен' : 'Локальный мир';
      draw();
    }
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      pause();
      renderer = null;
      play.disabled = true;
      q('.blocks-resume').disabled = true;
      saveStatus.textContent = 'Ожидаем восстановления графики';
    }, {signal});
    canvas.addEventListener('webglcontextrestored', () => {
      renderer = new Renderer(canvas, world);
      play.disabled = false;
      q('.blocks-resume').disabled = false;
      saveStatus.textContent = 'Графика восстановлена';
      draw();
    }, {signal});

    const observer = new ResizeObserver(() => { if (mode === 'paused') draw(); });
    observer.observe(canvas);
    let lastHeatTick = performance.now();
    const heatTimer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(1000, now - lastHeatTick);
      lastHeatTick = now;
      if (!progress || signal.aborted || document.hidden) return;
      const {changed, active} = progress.tickFurnaces(elapsed);
      if (active) unsaved = true;
      if (changed) {
        afterProgress();
        panel.refresh();
      } else if (active) panel.updateHeat();
    }, 150);
    inventoryBar.inert = true;
    showWorld(initial.data);

    win.beforeClose = async () => {
      pause();
      return save() || !!await ask('Закрыть GreenBlocks?', {
        message: 'Сохранение недоступно. Изменения этой сессии могут потеряться.', confirm: true, ok: 'Закрыть игру',
      });
    };
    return () => { clearInterval(heatTimer); pause(); observer.disconnect(); renderer?.dispose(); };
  },
};
