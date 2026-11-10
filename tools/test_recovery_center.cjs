const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {chromium, launchOptions, baseURL, unlockDesktop} = require('./browser_test_support.cjs');

async function launchApp(page, name) {
  await page.getByRole('button',{name:'Меню приложений',exact:true}).click();
  await page.locator('#app-search').fill(name);
  await page.locator('.launcher-app').filter({has:page.getByText(name,{exact:true})}).click();
}

const office = page => page.locator('.os-window[data-app="office"]');
const center = page => page.locator('.os-window[data-app="recovery"]');
const checkpoints = page => office(page).locator('[data-draft-state="saved"]');
const dialog = page => page.locator('#system-dialog');
const radio = page => page.locator('.os-window[data-app="radio"]');
const fixture = {name:'Рабочий файл.txt', data:'Данные для переноса'};
const campaign = {version:1,scrap:120,cleared:2,upgrades:{weapon:1,armor:0,engine:2,magnet:0}};

async function checkVolume(page, volume) {
  assert.equal(await radio(page).getByRole('slider',{name:'Громкость'}).inputValue(),String(volume));
  assert.equal(await radio(page).locator('audio').evaluate(node=>node.volume),volume/100);
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const options = {viewport:{width:1440,height:960},acceptDownloads:true};
  const errors = [];
  const monitor = page => page.on('pageerror',error=>errors.push(error.message));
  try {
    const original = await browser.newContext(options);
    const page = await original.newPage();
    monitor(page);
    await page.goto(baseURL);
    await unlockDesktop(page);
    await launchApp(page,'Документы');

    const word = office(page).first();
    await word.getByRole('button',{name:'Создать DOCX'}).click();
    await word.getByRole('textbox',{name:'Имя документа'}).fill('Документ после сбоя');
    await word.getByRole('textbox',{name:'Текст документа',exact:true}).press('End');
    await page.keyboard.insertText('Восстановленная правка Word');
    await checkpoints(page).waitFor();

    await launchApp(page,'Документы');
    const excel = office(page).last();
    await excel.getByRole('button',{name:'Создать XLSX'}).click();
    const value = excel.getByRole('textbox',{name:'Значение ячейки'});
    await value.fill('=SUM(');
    await excel.locator('[data-draft-state="saved"]').waitFor();

    const crashed = page.waitForEvent('crash');
    const session = await original.newCDPSession(page);
    void session.send('Page.crash').catch(()=>{});
    await crashed;
    await page.close();

    const recovered = await original.newPage();
    monitor(recovered);
    await recovered.goto(baseURL);
    await unlockDesktop(recovered);
    assert.equal(await center(recovered).count(),0);
    await launchApp(recovered,'Центр восстановления');
    const drafts = center(recovered).locator('.recovery-draft');
    const wordDraft = drafts.filter({hasText:'Документ после сбоя.docx'});
    const excelDraft = drafts.filter({hasText:'Новая книга.xlsx'});
    await excelDraft.getByRole('button',{name:'Восстановить',exact:true}).click();
    const recoveredValue = office(recovered).getByRole('textbox',{name:'Значение ячейки'});
    assert.equal(await recoveredValue.inputValue(),'=SUM(');
    await office(recovered).getByRole('button',{name:'Сохранить XLSX',exact:true}).click();
    await recovered.locator('#toast-area .toast.error').waitFor();
    await office(recovered).getByRole('button',{name:'Закрыть',exact:true}).click();
    await dialog(recovered).getByRole('button',{name:'Сохранить черновик и продолжить'}).click();
    await office(recovered).waitFor({state:'detached'});
    await wordDraft.getByRole('button',{name:'Восстановить',exact:true}).click();
    await office(recovered).getByRole('textbox',{name:'Текст документа',exact:true})
      .getByText('Восстановленная правка Word',{exact:true}).waitFor();
    await office(recovered).getByRole('button',{name:'Сохранить DOCX',exact:true}).click();
    await office(recovered).getByText('DOCX · Сохранено',{exact:true}).waitFor();
    await wordDraft.waitFor({state:'detached'});

    const peer = await original.newPage();
    await peer.goto(baseURL);
    await unlockDesktop(peer);
    const peerRevision = await peer.evaluate(async()=>{
      const {fs}=await import('/assets/storage.js');
      const previous=fs.list('documents').find(node=>node.name==='Документ после сбоя.docx');
      const updated=await fs.write('documents',previous.name,previous.data,previous.mime,previous.id,{expected:previous});
      return updated.revision;
    });
    const recoveredPaper=office(recovered).getByRole('textbox',{name:'Текст документа',exact:true});
    await recoveredPaper.press('End');
    await recovered.keyboard.insertText(' с новой правкой');
    await office(recovered).getByRole('button',{name:'Сохранить DOCX',exact:true}).click();
    const newCopy=office(recovered).getByRole('button',{name:'Сохранить как новую копию'});
    await newCopy.click();
    await office(recovered).getByText('DOCX · Сохранено',{exact:true}).waitFor();
    const revisions=await recovered.evaluate(async()=>{
      const {fs}=await import('/assets/storage.js');
      return Object.fromEntries(fs.list('documents').filter(node=>node.name.endsWith('.docx')).map(node=>[node.name,node.revision]));
    });
    assert.equal(revisions['Документ после сбоя.docx'],peerRevision);
    assert.ok(revisions['Документ после сбоя (2).docx']);
    await peer.close();

    await launchApp(recovered,'Радио');
    await checkVolume(recovered,65);
    const slider = radio(recovered).getByRole('slider',{name:'Громкость'});
    await slider.press('Home');
    await checkVolume(recovered,0);
    await radio(recovered).getByRole('button',{name:'Закрыть',exact:true}).click();
    await radio(recovered).waitFor({state:'detached'});
    await launchApp(recovered,'Радио');
    await checkVolume(recovered,0);
    await slider.press('ArrowRight');
    await checkVolume(recovered,1);
    await recovered.reload();
    await unlockDesktop(recovered);
    assert.equal(await center(recovered).count(),0);
    await launchApp(recovered,'Радио');
    await checkVolume(recovered,1);

    await recovered.evaluate(async ({name,data,campaign})=>{
      const {fs}=await import('/assets/storage.js');
      const {settings}=await import('/assets/core.js');
      const {updateAvatar}=await import('/assets/profile.js');
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=8;
      const paint=canvas.getContext('2d');
      paint.fillStyle='#ed8090';
      paint.fillRect(0,0,8,8);
      await updateAvatar(await new Promise(resolve=>canvas.toBlob(resolve,'image/png')));
      settings.set({name:'Профиль из копии',theme:'light',accent:'#428ef0'});
      localStorage.setItem('greenos-galaxy-best-v1','431');
      localStorage.setItem('greenos-galaxy-campaign-v1',JSON.stringify(campaign));
      await fs.write('documents',name,new TextEncoder().encode(data));
    },{...fixture,campaign});
    await launchApp(recovered,'Центр восстановления');
    const downloaded = recovered.waitForEvent('download');
    await center(recovered).getByRole('button',{name:'Скачать резервную копию'}).click();
    const archive = await downloaded;
    assert.match(archive.suggestedFilename(),/\.greenos$/);
    const backup = await readFile(await archive.path());

    const clean = await browser.newContext(options);
    const target = await clean.newPage();
    monitor(target);
    await target.goto(baseURL);
    await unlockDesktop(target);
    assert.equal(await center(target).count(),0);
    await launchApp(target,'Центр восстановления');
    const importButton = center(target).getByRole('button',{name:'Восстановить из копии…'});
    const setBackup = async buffer => {
      const chosen = target.waitForEvent('filechooser');
      await importButton.click();
      await (await chosen).setFiles({name:'Test.greenos',mimeType:'application/octet-stream',buffer});
    };
    const broken = Buffer.from(backup);
    broken[broken.length-1]^=1;
    await setBackup(broken);
    await center(target).getByText('Контрольная сумма не совпадает.',{exact:false}).waitFor();
    assert.equal(await target.locator('#user-label').textContent(),'green');

    await setBackup(backup);
    const confirm = dialog(target).getByRole('button',{name:'Восстановить рабочее пространство'});
    const reloaded = target.waitForEvent('framenavigated',frame=>frame===target.mainFrame());
    await confirm.click();
    await reloaded;
    await unlockDesktop(target);
    assert.equal(await center(target).count(),0);
    await launchApp(target,'Радио');
    await checkVolume(target,1);
    await launchApp(target,'Центр восстановления');
    await center(target).locator('.recovery-draft').filter({hasText:'Новая книга.xlsx'}).waitFor();
    assert.equal(await target.locator('#user-label').textContent(),'Профиль из копии');
    assert.equal(await target.locator('body').getAttribute('data-theme'),'light');
    assert.equal(await target.locator('#launcher-avatar img').count(),1);
    assert.equal(await target.evaluate(async name=>{
      const {fs}=await import('/assets/storage.js');
      return new TextDecoder().decode(fs.list('documents').find(node=>node.name===name)?.data);
    },fixture.name),fixture.data);
    assert.equal(await target.evaluate(()=>localStorage.getItem('greenos-galaxy-best-v1')),'431');
    assert.deepEqual(await target.evaluate(()=>JSON.parse(localStorage.getItem('greenos-galaxy-campaign-v1'))),campaign);
    assert.deepEqual(errors,[]);
    console.log('Recovery Center opens on request, Office drafts survive a crash, radio volume and Galaxy campaign survive clean-profile import.');
  } finally {
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
