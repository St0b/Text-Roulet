const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, launchOptions, baseURL} = require('./browser_test_support.cjs');

async function verifyCampaign() {
  const {BLOCK, DEFAULT_SEED, World, indexOf} = await import('../frontend/static/blocks/world.js');
  const {Expedition, miningRule} = await import('../frontend/static/blocks/expedition.js');
  const {ITEM} = await import('../frontend/static/blocks/items.js');
  const {RECIPES, recipeLayout} = await import('../frontend/static/blocks/crafting.js');
  const {COOK_TIME} = await import('../frontend/static/blocks/furnace.js');
  const world = new World(DEFAULT_SEED, [], true);
  assert.ok(world.base.includes(BLOCK.ore));
  assert.ok(world.base.includes(BLOCK.coalOre));
  assert.ok(!new World(DEFAULT_SEED).base.includes(BLOCK.ore));
  assert.ok(!new World(DEFAULT_SEED).base.includes(BLOCK.coalOre));
  let progress = new Expedition(null, world);
  const craft = id => {
    const recipe = RECIPES.find(entry => entry.id === id);
    const size = recipe.bench ? 3 : 2;
    assert.ok(progress.craft(recipeLayout(recipe, size, progress), size), id);
    progress.advance(world);
  };
  const collect = (block, count) => {
    const rule = miningRule(block, progress.tool);
    assert.ok(rule.item, rule.message);
    for (let i = 0; i < count; i++) progress.collect(rule.item);
    progress.advance(world);
  };
  const place = (block, x, z) => {
    assert.ok(progress.count(block) > 0);
    assert.ok(world.set(x, 23, z, block));
    assert.ok(progress.withdraw(block, 1));
    progress.advance(world);
  };
  assert.ok(miningRule(BLOCK.stone, progress.tool).message);
  assert.ok(miningRule(BLOCK.coalOre, progress.tool).message);
  collect(BLOCK.log, 16);
  craft('boards');
  craft('workbench');
  place(BLOCK.workbench, 30, 26);
  craft('boards');
  craft('boards');
  craft('sticks');
  craft('wood-pick');
  assert.equal(progress.chapter, 1);
  assert.ok(miningRule(BLOCK.ore, progress.tool).message);
  collect(BLOCK.coalOre, 6);
  collect(BLOCK.stone, 12);
  craft('boards');
  craft('stone-pick');
  craft('furnace');
  place(BLOCK.furnace, 29, 25);
  const furnaceIndex = indexOf(29, 23, 25);
  let furnace = progress.furnace(furnaceIndex);
  assert.equal(progress.chapter, 2);
  collect(BLOCK.ore, 9);
  assert.equal(furnace.load('fuel', ITEM.ore, 1, progress), false);
  assert.equal(progress.count(ITEM.ore), 9);
  assert.ok(furnace.load('input', ITEM.ore, 9, progress));
  assert.ok(furnace.load('fuel', ITEM.coal, 2, progress));
  progress.tickFurnaces(COOK_TIME / 2);
  progress = new Expedition(JSON.parse(JSON.stringify(progress)), world);
  furnace = progress.furnace(furnaceIndex);
  assert.equal(furnace.cook, COOK_TIME / 2);
  assert.equal(furnace.fuel.count, 1);
  progress.tickFurnaces(COOK_TIME * 9 - COOK_TIME / 2);
  assert.equal(furnace.output.count, 9);
  assert.equal(progress.count(ITEM.iron), 0);
  assert.ok(furnace.unload('output', progress));
  craft('sticks');
  craft('iron-pick');
  assert.equal(progress.chapter, 3);
  assert.ok(miningRule(BLOCK.ore, progress.tool).seconds < miningRule(BLOCK.ore, 2).seconds);
  craft('lantern');
  craft('lantern');
  for (let i = 0; i < 4; i++) craft('boards');
  craft('workbench');
  place(BLOCK.workbench, 55, 25);
  for (let x = 27; x <= 32; x++) {
    place(BLOCK.boards, x, 27);
    place(BLOCK.boards, x, 28);
  }
  place(BLOCK.lantern, 55, 24);
  place(BLOCK.lantern, 55, 26);
  assert.equal(progress.chapter, 3, 'lanterns at a different workbench do not complete the settlement');
  for (const z of [24, 26]) {
    assert.ok(world.set(55, 23, z, BLOCK.air));
    collect(BLOCK.lantern, 1);
    place(BLOCK.lantern, 29, z);
  }
  assert.equal(progress.chapter, 4);
  assert.equal(progress.flightUnlocked, false);
  collect(BLOCK.sand, 2);
  assert.ok(furnace.load('input', BLOCK.sand, 2, progress));
  progress.tickFurnaces(2 * COOK_TIME);
  assert.ok(furnace.unload('output', progress));
  craft('beacon');
  place(BLOCK.beacon, 28, 25);
  assert.equal(progress.chapter, 5);
  assert.equal(progress.flightUnlocked, true);
  assert.equal(progress.count(ITEM.iron), 0);
  progress = new Expedition(JSON.parse(JSON.stringify(progress)), world);
  assert.equal(progress.flightUnlocked, true);
  assert.equal(progress.tool, 3);
  assert.equal(new World(world.seed, [...world.edits], true).get(28, 23, 25), BLOCK.beacon);
  const migrated = new Expedition({inventory: {[ITEM.charcoal]: 7, [BLOCK.stone]: 4}}, world, BLOCK.stone);
  assert.equal(migrated.count(ITEM.charcoal), 7);
  assert.equal(migrated.hotbar[3], BLOCK.stone);
  assert.ok(migrated.moveToHotbar(ITEM.charcoal, 3));
  assert.ok(migrated.backpack().includes(BLOCK.stone));
  assert.ok(migrated.moveToHotbar(BLOCK.stone, 8));
  assert.ok(migrated.moveToHotbar(ITEM.charcoal, 8));
  assert.deepEqual([migrated.hotbar[3], migrated.hotbar[8]], [BLOCK.stone, ITEM.charcoal]);
  console.log('PASS: five chapters, coal gates, furnace persistence, inventory swaps and legacy charcoal');
}

async function verifySurvival() {
  const {BLOCK, DEFAULT_SEED, World, indexOf} = await import('../frontend/static/blocks/world.js');
  const {ITEM} = await import('../frontend/static/blocks/items.js');
  const {Expedition} = await import('../frontend/static/blocks/expedition.js');
  const {Survival} = await import('../frontend/static/blocks/survival.js');
  const {Farm} = await import('../frontend/static/blocks/farming.js');
  const {blockLights, lightAt, skyLight} = await import('../frontend/static/blocks/lighting.js');
  const world = new World(DEFAULT_SEED, [], true);
  const inventory = new Expedition(null, world);
  const player = {x: 33.5, y: 25, z: 43.5, yaw: 0, pitch: 0};
  const simulation = new Survival({health: 3, food: 8, mobs: [
    {kind: 'zombie', health: 7, x: 33.5, y: 25, z: 41.5, yaw: Math.PI},
  ]});
  inventory.deposit(ITEM.cookedPork, 1);
  inventory.deposit(ITEM.ironSword, 1);
  assert.ok(inventory.moveToHotbar(ITEM.ironSword, 2));
  assert.ok(simulation.eat(ITEM.cookedPork, inventory));
  assert.equal(simulation.food, 16);
  assert.equal(inventory.count(ITEM.cookedPork), 0);
  assert.equal(simulation.targetMob(player, {distance: 1}), null);
  assert.match(simulation.attack(simulation.targetMob(player), ITEM.ironSword, inventory), /повержен/);
  assert.equal(inventory.count(ITEM.rottenFlesh), 1);
  assert.ok(simulation.hurt(3));
  assert.ok(simulation.dead);
  simulation.respawn(player, inventory);
  assert.equal(simulation.health, 20);
  assert.equal(inventory.hotbar[2], null);
  assert.equal(inventory.count(ITEM.ironSword), 0);
  const restored = new Survival(JSON.parse(JSON.stringify(simulation)));
  restored.spawnIn = Infinity;
  assert.match(restored.tick(.05, world, player, inventory, {impact: 0}), /возвращены/);
  assert.equal(inventory.count(ITEM.ironSword), 1);
  assert.equal(restored.caches.length, 0);
  assert.equal(restored.tick(.05, world, player, inventory, {impact: 0}), '');
  assert.equal(inventory.count(ITEM.ironSword), 1);

  assert.ok(skyLight(.76) < skyLight(.24));
  assert.ok(world.set(33, 24, 41, BLOCK.farmland));
  assert.ok(world.set(33, 25, 41, BLOCK.wheatSeedling));
  const crop = [33, 25, 41];
  let farm = new Farm(world);
  assert.deepEqual(farm.tick(50, world, skyLight(.76), null), []);
  assert.ok(world.set(34, 25, 41, BLOCK.torch));
  const levels = blockLights(world);
  assert.ok(lightAt(levels, ...crop) > .5);
  assert.deepEqual(farm.tick(48, world, skyLight(.76), levels), [crop]);
  assert.equal(world.get(...crop), BLOCK.wheatGreen);
  assert.deepEqual(farm.tick(24, world, skyLight(.76), levels), []);
  const growth = JSON.parse(JSON.stringify(farm));
  assert.equal(growth[indexOf(...crop)], 12);
  farm = new Farm(world, growth);
  assert.deepEqual(farm.tick(24, world, skyLight(.76), levels), [crop]);
  assert.equal(world.get(...crop), BLOCK.wheatRipe);
  console.log('PASS: hunger, food, hit occlusion, recoverable death, torchlight and saved crop growth');
}

async function verifyBrowser() {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 960}});
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => {
      errors.push(error.message);
      console.error(error);
    });
    const creativeKey = 'greenos-greenblocks-v1';
    const expeditionKey = 'greenos-greenblocks-expedition-v1';
    await page.goto(baseURL);
    const oldSave = await page.evaluate(async ({creativeKey, expeditionKey}) => {
      const {BLOCK, DEFAULT_SEED, SIZE} = await import('/assets/blocks/world.js');
      const index = (x, y, z) => (y * SIZE + z) * SIZE + x;
      const oldSave = JSON.stringify({version: 1, seed: 123, edits: [[index(30, 20, 57), BLOCK.bricks]], material: BLOCK.bricks});
      localStorage.setItem(creativeKey, oldSave);
      localStorage.setItem(expeditionKey, JSON.stringify({
        version: 1, seed: DEFAULT_SEED, player: {x: 31.5, y: 17, z: 57.5, yaw: 0, pitch: 0},
        edits: [[index(31, 16, 57), BLOCK.stone], [index(31, 18, 52), BLOCK.stone],
          ...[53, 54, 55].map(z => [index(31, 18, z), BLOCK.log])],
      }));
      return oldSave;
    }, {creativeKey, expeditionKey});
    const launch = async () => {
      await page.getByRole('button', {name: 'Меню приложений', exact: true}).click();
      await page.locator('#app-search').fill('GreenBlocks');
      await page.locator('.launcher-app').click();
    };
    await launch();
    const game = page.locator('.os-window[data-app="blocks"]');
    const stage = game.locator('.blocks-stage');
    const play = async selector => {
      await game.locator(selector).click();
      await page.waitForFunction(() => document.pointerLockElement?.matches('.blocks-canvas'));
      await game.locator('.blocks-crosshair').waitFor();
    };
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), expeditionKey);
    const clickBlock = async button => {
      await page.mouse.down({button});
      await page.mouse.up({button});
    };
    await play('.blocks-play');
    await page.keyboard.press('KeyF');
    assert.match(await game.locator('.blocks-save').textContent(), /Маяк/);
    for (let count = 1; count <= 3; count++) {
      await clickBlock('left');
      await page.waitForFunction(({key, count}) => JSON.parse(localStorage.getItem(key)).progress?.gathered[5] === count,
        {key: expeditionKey, count});
    }
    await clickBlock('left');
    assert.match(await game.locator('.blocks-save').textContent(), /нужна деревянная кирка/);
    await page.keyboard.press('KeyE');
    await game.locator('.blocks-workshop').waitFor();
    assert.match(await game.locator('.blocks-tasks').textContent(), /3 \/ 3/);
    const cell = id => game.locator(`[data-cell="${id}"]`);
    const recipe = id => game.locator(`[data-recipe="${id}"]`);
    const craft = async id => {
      await recipe(id).click();
      await cell('result').click();
    };
    assert.equal(await game.locator('.blocks-craft-grid button').count(), 4);
    assert.equal(await recipe('wood-pick').count(), 0);
    await cell('pack-5').click();
    await cell('craft-3').click();
    await cell('result').click();
    await craft('workbench');
    await craft('boards');
    await cell('result').click();
    await craft('sticks');
    await cell('pack-12').dragTo(cell('bar-8'));
    assert.equal((await saved()).progress.hotbar[8], 12);
    await cell('bar-8').click({button: 'right'});
    assert.equal((await saved()).progress.hotbar[8], null);
    await cell('pack-12').click();
    await cell('bar-8').click();
    await play('.blocks-resume');
    await page.keyboard.press('Digit9');
    assert.match(await game.locator('.blocks-slot[aria-pressed="true"]').getAttribute('aria-label'), /^9\. Верстак/);
    await clickBlock('right');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).progress?.inventory[12] === 0, expeditionKey);
    await clickBlock('right');
    await game.getByRole('heading', {name: 'Верстак', exact: true}).waitFor();
    assert.equal(await game.locator('.blocks-craft-grid button').count(), 9);
    await craft('wood-pick');
    assert.equal((await saved()).progress.chapter, 1);
    fs.mkdirSync('test-results', {recursive: true});
    await stage.screenshot({path: 'test-results/greenblocks-expedition.png'});
    await game.locator('.blocks-back-pause').click();
    await game.locator('[data-block-mode="creative"]').click();
    assert.match(await game.locator('.blocks-material').textContent(), /Кирпич/);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), creativeKey), oldSave);
    await game.locator('[data-block-mode="expedition"]').click();
    assert.match(await game.locator('.blocks-material').textContent(), /Деревянная кирка/);

    const close = async () => {
      await game.locator('button[data-action="close"]').click();
      await game.waitFor({state: 'detached'});
    };
    await close();
    const [firstFurnace, secondFurnace] = await page.evaluate(async key => {
      const {BLOCK, indexOf} = await import('/assets/blocks/world.js');
      const {ITEM} = await import('/assets/blocks/items.js');
      const save = JSON.parse(localStorage.getItem(key));
      const first = indexOf(31, 18, 53), second = indexOf(31, 18, 52);
      const edits = new Map(save.edits);
      edits.set(first, BLOCK.furnace);
      edits.set(second, BLOCK.furnace);
      save.edits = [...edits];
      Object.assign(save.progress.inventory, {[ITEM.ore]: 2, [ITEM.coal]: 2});
      localStorage.setItem(key, JSON.stringify(save));
      return [first, second];
    }, expeditionKey);
    await launch();
    await play('.blocks-play');
    await clickBlock('right');
    await game.getByRole('heading', {name: 'Печь', exact: true}).waitFor();
    await cell('pack-101').click();
    assert.ok(await game.locator('[data-load="fuel"]').isDisabled());
    await cell('furnace-input').click();
    await cell('pack-101').dragTo(cell('furnace-input'));
    await cell('pack-103').click();
    await game.locator('[data-load="fuel"]').click();
    await page.waitForFunction(({key, index}) => JSON.parse(localStorage.getItem(key)).progress.furnaces[index]?.burn > 0,
      {key: expeditionKey, index: firstFurnace});
    await stage.screenshot({path: 'test-results/greenblocks-furnace.png'});
    await game.locator('.blocks-back-pause').click();
    await page.waitForFunction(({key, index}) => JSON.parse(localStorage.getItem(key)).progress.furnaces[index]?.output?.count === 2,
      {key: expeditionKey, index: firstFurnace});
    await close();
    await launch();
    await play('.blocks-play');
    await clickBlock('right');
    await game.locator('[data-take="output"]').click();
    assert.equal((await saved()).progress.inventory[102], 2);
    await play('.blocks-resume');
    await clickBlock('left');
    await page.waitForFunction(({key, index}) => !(index in JSON.parse(localStorage.getItem(key)).progress.furnaces),
      {key: expeditionKey, index: firstFurnace});
    assert.equal((await saved()).progress.inventory[103], 1);
    await clickBlock('right');
    await game.getByRole('heading', {name: 'Печь', exact: true}).waitFor();
    assert.ok(await game.locator('[data-take="output"]').isDisabled());
    assert.equal((await saved()).progress.furnaces[secondFurnace], undefined);
    await close();
    await page.evaluate(async key => {
      const {BLOCK, World, cellFromIndex, indexOf} = await import('/assets/blocks/world.js');
      const save = JSON.parse(localStorage.getItem(key));
      const world = new World(save.seed, save.edits, true);
      const index = world.blocks.findIndex((block, position) => {
        const [x, y, z] = cellFromIndex(position);
        return block === BLOCK.coalOre && x > 12 && y > 4 && z > 8 && z < 60;
      });
      if (index < 0) throw new Error('The expedition seed has no coal for the tunnel fixture');
      const [x, y, z] = cellFromIndex(index);
      const edits = new Map(save.edits);
      for (let offset = 1; offset <= 3; offset++) {
        edits.set(indexOf(x, y - 1, z + offset), BLOCK.air);
        edits.set(indexOf(x, y, z + offset), BLOCK.air);
      }
      edits.set(indexOf(x, y - 2, z + 3), BLOCK.stone);
      save.edits = [...edits];
      save.player = {x: x + .5, y: y - 1, z: z + 3.5, yaw: 0, pitch: 0};
      localStorage.setItem(key, JSON.stringify(save));
    }, expeditionKey);
    await launch();
    await play('.blocks-play');
    await clickBlock('left');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).progress.inventory[103] === 2, expeditionKey);
    const pauseAndClose = async () => {
      await page.keyboard.press('Escape');
      await game.locator('.blocks-pause').waitFor();
      await close();
    };
    await pauseAndClose();
    const survivalFixture = async ({death = false, farm = false} = {}) => page.evaluate(async ({key, death, farm}) => {
      const {BLOCK, indexOf} = await import('/assets/blocks/world.js');
      const {ITEM} = await import('/assets/blocks/items.js');
      const {DAY_LENGTH} = await import('/assets/blocks/lighting.js');
      const save = JSON.parse(localStorage.getItem(key));
      const edits = new Map(save.edits);
      for (let z = 53; z <= 58; z++) {
        edits.set(indexOf(31, 16, z), z === 56 ? BLOCK.dirt : BLOCK.stone);
        for (const y of [17, 18]) edits.set(indexOf(31, y, z), BLOCK.air);
      }
      edits.set(indexOf(31, 18, 52), BLOCK.air);
      edits.set(indexOf(32, 17, 55), BLOCK.torch);
      save.edits = [...edits];
      save.player = {x: 31.5, y: 17, z: 57.5, yaw: 0, pitch: farm ? -.9 : 0};
      save.slot = 0;
      save.progress.hotbar = [ITEM.ironSword, ITEM.cookedPork, ITEM.woodHoe, ITEM.seed];
      Object.assign(save.progress.inventory, {[ITEM.ironSword]: 1, [ITEM.cookedPork]: 1, [ITEM.woodHoe]: 1, [ITEM.seed]: 2});
      save.survival = {health: death ? 3 : 20, food: 9, time: DAY_LENGTH * .76,
        mobs: farm ? [] : [{kind: 'zombie', x: 31.5, y: 17, z: death ? 56.35 : 55, health: death ? 20 : 6, yaw: Math.PI}]};
      localStorage.setItem(key, JSON.stringify(save));
    }, {key: expeditionKey, death, farm});
    await survivalFixture();
    await launch();
    await play('.blocks-play');
    await game.getByText('НОЧЬ 1', {exact: true}).waitFor();
    await game.getByText(/ЛКМ · Зомби/).waitFor();
    await stage.screenshot({path: 'test-results/greenblocks-survival.png'});
    await clickBlock('left');
    assert.equal((await saved()).progress.inventory[108], 1);
    await page.keyboard.press('Digit2');
    await clickBlock('right');
    assert.equal((await saved()).progress.inventory[107], 0);
    assert.equal((await saved()).survival.food, 17);
    await pauseAndClose();

    await survivalFixture({farm: true});
    await launch();
    await play('.blocks-play');
    await page.keyboard.press('Digit3');
    await clickBlock('right');
    assert.match(await game.locator('.blocks-save').textContent(), /Грядка готова/);
    await page.keyboard.press('Digit4');
    await clickBlock('right');
    assert.match(await game.locator('.blocks-save').textContent(), /Пшеница посажена/);
    assert.equal((await saved()).progress.inventory[113], 1);
    await pauseAndClose();

    await survivalFixture({death: true});
    await launch();
    await game.locator('.blocks-play').click();
    await game.getByRole('heading', {name: 'Ты погиб'}).waitFor();
    await game.getByRole('button', {name: 'Возродиться'}).click();
    assert.equal((await saved()).survival.caches[0].items[111], 1);
    assert.equal((await saved()).progress.inventory[111], 0);
    await play('.blocks-play');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).survival.caches.length === 0, expeditionKey);
    assert.equal((await saved()).progress.inventory[111], 1);
    assert.deepEqual(errors, []);
    console.log('PASS: crafting, coal, smelting, night combat, eating, farming and death recovery in Chromium');
  } finally {
    await browser.close();
  }
}

(async () => {
  await verifyCampaign();
  await verifySurvival();
  await verifyBrowser();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
