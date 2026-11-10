const {chromium,launchOptions,baseURL,unlockDesktop}=require('./browser_test_support.cjs');
const assert=require('node:assert/strict');
const path=require('node:path');
const fsNode=require('node:fs');
(async()=>{
 const browser=await chromium.launch(launchOptions());const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  fsNode.mkdirSync('test-results',{recursive:true});await page.goto(baseURL);await unlockDesktop(page);await page.locator('.welcome-main').waitFor();
  await page.evaluate(async()=>{
   const {fs}=await import('/assets/storage.js'),{wm}=await import('/assets/windows.js');
   const dir=await fs.mkdir('documents','Recovery folder');const file=await fs.write(dir.id,'original.txt',new TextEncoder().encode('PERSISTENT_CONTENT'));
   await fs.rename(file.id,'renamed.txt');await fs.move(file.id,'shared');await fs.trash(file.id);await fs.restore(file.id);
   await wm.open('editor',{name:'Draft.txt',draft:'UNSAVED_DRAFT_RECOVERY'});
  });
  await page.waitForTimeout(800);await page.reload();await unlockDesktop(page);await page.locator('.os-window[data-app="editor"] .editor-area').waitFor();
  assert.equal(await page.locator('.editor-area').inputValue(),'UNSAVED_DRAFT_RECOVERY');
  assert.equal(await page.evaluate(async()=>{const {fs}=await import('/assets/storage.js');return new TextDecoder().decode(fs.list('shared').find(n=>n.name==='renamed.txt').data);}), 'PERSISTENT_CONTENT');
  console.log('PASS: folder operations, files and unsaved editor draft survive reload');
  await page.evaluate(async()=>{const {wm}=await import('/assets/windows.js');await wm.open('settings');});
  await page.locator('[data-tab="data"]').click();let pending=page.waitForEvent('download');await page.locator('.backup').click();const backup=await pending;const backupPath=path.resolve('test-results/files-backup.json');await backup.saveAs(backupPath);
  await page.evaluate(async()=>{const {fs}=await import('/assets/storage.js');await fs.write('documents','after-backup.txt',new TextEncoder().encode('SHOULD_BE_REPLACED'));});
  let chooser=page.waitForEvent('filechooser');await page.locator('.restore').click();await(await chooser).setFiles(backupPath);await page.locator('#system-dialog button[value="ok"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast-area').textContent.includes('Архив файлов восстановлен'));
  assert.equal(await page.evaluate(async()=>{const {fs}=await import('/assets/storage.js');return fs.list('documents').some(n=>n.name==='after-backup.txt');}),false);
  console.log('PASS: JSON backup export and atomic restore');
  await page.evaluate(async()=>{const {wm}=await import('/assets/windows.js');await wm.open('linux',{autostart:true});});
  await page.waitForFunction(()=>document.querySelector('.vm-status')?.textContent==='Linux работает · /mnt — общие файлы',null,{timeout:60000});
  await page.evaluate(async()=>{const {linux}=await import('/assets/linux.js');window.output='';linux.vm.add_listener('serial0-output-byte',b=>window.output+=String.fromCharCode(b));linux.vm.serial0_send("printf 'EXPORTED_VM_RECOVERY' > /mnt/checkpoint.txt\necho SNAPSHOT_READY\n");});
  await page.waitForFunction(()=>/\r?\nSNAPSHOT_READY\r?\n/.test(window.output));await page.locator('.vm-save').click();await page.waitForFunction(()=>document.querySelector('.vm-save-time').textContent.startsWith('Снимок:'),null,{timeout:30000});
  pending=page.waitForEvent('download');await page.locator('.vm-export').click();const exported=await pending;const snapshotPath=path.resolve('test-results/exported.gvm');await exported.saveAs(snapshotPath);
  await page.evaluate(async()=>{const {wm}=await import('/assets/windows.js');for(const w of [...wm.windows])if(w.app.id==='linux')await wm.close(w,true);});
  await page.waitForTimeout(800);await page.reload();await unlockDesktop(page);await page.locator('.editor-area').waitFor();
  await page.evaluate(async()=>{const {wm}=await import('/assets/windows.js');await wm.open('linux');});chooser=page.waitForEvent('filechooser');await page.locator('.vm-import').click();await(await chooser).setFiles(snapshotPath);
  await page.waitForFunction(()=>document.querySelector('.vm-status')?.textContent==='Снимок восстановлен',null,{timeout:30000});
  assert.equal(await page.evaluate(async()=>{const {linux}=await import('/assets/linux.js');return new TextDecoder().decode(await linux.vm.read_file('checkpoint.txt'));}), 'EXPORTED_VM_RECOVERY');
  console.log('PASS: exported .gvm snapshot restores Linux files after a full page reload');
  // Clicking the shell's editor must keep keyboard input out of the guest PC.
  await page.evaluate(async()=>{const {wm}=await import('/assets/windows.js');wm.restore(wm.windows.find(w=>w.app.id==='editor'));});await page.locator('.editor-area').fill('KEYBOARD_SCOPE_OK');assert.equal(await page.locator('.editor-area').inputValue(),'KEYBOARD_SCOPE_OK');
  assert.deepEqual(errors,[]);console.log('PASS: keyboard scope and no JavaScript errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
