const assert = require('node:assert/strict');
const {chromium,launchOptions,baseURL,unlockDesktop} = require('./browser_test_support.cjs');

async function openGalaxy(page) {
  await page.getByRole('button',{name:'Меню приложений',exact:true}).click();
  await page.locator('#app-search').fill('Галактика');
  await page.locator('.launcher-app').click();
  return page.locator('.os-window[data-app="galaxy"]');
}

const savedCampaign = page => page.evaluate(async()=>{
  const {GALAXY_CAMPAIGN_KEY}=await import('/assets/galaxy-campaign.js');
  return JSON.parse(localStorage.getItem(GALAXY_CAMPAIGN_KEY));
});

(async()=>{
  const browser=await chromium.launch(launchOptions());
  try {
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{Math.random=()=>.5;});
    await page.goto(baseURL);
    await unlockDesktop(page);
    let galaxy=await openGalaxy(page);
    const start=()=>galaxy.getByRole('button',{name:'Начать полёт',exact:true}).click();
    const overlay=()=>galaxy.locator('.galaxy-overlay');
    const loot=async()=>Number(await galaxy.locator('[data-stat="scrap"]').textContent());
    async function patrol(until) {
      const field=await galaxy.locator('canvas').boundingBox();
      const aim=x=>page.mouse.move(field.x+x*field.width/480,field.y+350*field.height/408);
      const route=[46,101,156,211,266,321,376,431,376,321,266,211,156,101];
      await aim(route[0]);
      await page.mouse.down();
      try {
        for (let turn=0;turn<48;turn++) {
          await aim(route[turn%route.length]);
          await page.clock.runFor(770);
          if (await overlay().isVisible() || await until()) break;
        }
      } finally { await page.mouse.up(); }
    }
    assert.equal(await galaxy.locator('[data-sector="1"]').isEnabled(),false);
    await start();
    await page.keyboard.press('p');
    await galaxy.getByRole('button',{name:'Продолжить',exact:true}).click();
    await overlay().waitFor({state:'hidden'});

    await page.clock.install();
    await patrol(()=>false);
    await galaxy.getByRole('button',{name:'Следующий сектор',exact:true}).waitFor();
    const earned=await savedCampaign(page);
    assert.equal(earned.cleared,1);
    assert.ok(earned.scrap>14,'Earn salvage during flight as well as the first-clear bonus');
    assert.equal(await galaxy.locator('[data-sector="1"]').isEnabled(),true);
    assert.equal(await galaxy.locator('[data-sector="2"]').isEnabled(),false);
    await galaxy.getByRole('button',{name:'Следующий сектор',exact:true}).click();
    await galaxy.getByText('Кладбище кораблей',{exact:true}).last().waitFor();

    await galaxy.getByRole('button',{name:'Ангар',exact:true}).click();
    await galaxy.getByRole('button',{name:'Улучшить модуль «Броня»',exact:true}).click();
    await galaxy.getByRole('heading',{name:'Броня 1/4'}).waitFor();
    const upgraded=await savedCampaign(page);
    assert.equal(upgraded.upgrades.armor,1);
    assert.equal(upgraded.scrap,earned.scrap-10);

    await page.reload();
    await unlockDesktop(page);
    galaxy=await openGalaxy(page);
    assert.equal(await galaxy.locator('[data-stat="hull"]').textContent(),'4/4');
    assert.equal(await galaxy.locator('[data-sector="1"]').getAttribute('aria-pressed'),'true');
    await galaxy.locator('[data-sector="0"]').click();
    assert.equal(await galaxy.locator('.galaxy-title').textContent(),'Сигнал маяка');
    await start();
    await patrol(async()=>await loot()>0);
    const replayLoot=await loot();
    assert.ok(replayLoot>0);
    await page.keyboard.press('p');
    await galaxy.getByRole('button',{name:'Завершить вылет',exact:true}).click();
    await galaxy.getByRole('button',{name:'Повторить вылет',exact:true}).waitFor();
    const replayed=await savedCampaign(page);
    assert.equal(replayed.cleared,1);
    assert.equal(replayed.scrap,upgraded.scrap+replayLoot);

    await galaxy.getByRole('button',{name:'Аркада',exact:true}).click();
    assert.equal(await galaxy.locator('[data-stat="hull"]').textContent(),'3/3');
    await start();
    await page.keyboard.press('p');
    await galaxy.getByRole('button',{name:'Продолжить',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: Galaxy flight rewards, mission unlock, replay, ship upgrade, reload, pause and classic arcade');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
