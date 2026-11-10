const assert = require('node:assert/strict');
const {deflateRawSync} = require('node:zlib');
const fs = require('node:fs');
const {chromium,launchOptions,baseURL,unlockDesktop} = require('./browser_test_support.cjs');

function zip(parts) {
  const local = [], central = [];
  let offset = 0;
  for (const [path, contents] of Object.entries(parts)) {
    const name = Buffer.from(path), data = Buffer.from(contents), packed = deflateRawSync(data);
    const header = Buffer.alloc(30), item = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    item.writeUInt32LE(0x02014b50);
    item.writeUInt16LE(20, 4);
    item.writeUInt16LE(20, 6);
    item.writeUInt16LE(8, 10);
    item.writeUInt32LE(packed.length, 20);
    item.writeUInt32LE(data.length, 24);
    item.writeUInt16LE(name.length, 28);
    item.writeUInt32LE(offset, 42);
    local.push(header, name, packed);
    central.push(item, name);
    offset += header.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function pdfFixture() {
  const stream = 'BT /F1 26 Tf 40 270 Td (GreenOS local PDF) Tj ET\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 320] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let source = '%PDF-1.4\n';
  const offsets = objects.map((content, i) => {
    const at = source.length;
    source += `${i + 1} 0 obj\n${content}\nendobj\n`;
    return at;
  });
  const xref = source.length;
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.map(at => String(at).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const X = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const word = image => zip({
  '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  'word/document.xml': `<w:document xmlns:w="${W}" xmlns:a="${A}" xmlns:r="${R}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Отчёт GreenOS</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>&lt;script&gt; безопасный текст</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><a:blip r:embed="img1"/></w:drawing><w:drawing><a:blip r:embed="external"/></w:drawing></w:r></w:p></w:body></w:document>`,
  'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="img1" Target="media/image.png"/><Relationship Id="external" TargetMode="External" Target="https://example.invalid/remote.png"/></Relationships>`,
  'word/media/image.png': image,
});
const slide = text => `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const slides = zip({
  'ppt/presentation.xml': `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rB"/><p:sldId id="257" r:id="rA"/></p:sldIdLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rA" Target="slides/a.xml"/><Relationship Id="rB" Target="slides/b.xml"/></Relationships>`,
  'ppt/slides/a.xml': slide('Второй слайд'),
  'ppt/slides/b.xml': slide('Первый слайд'),
});
const book = zip({
  'xl/workbook.xml': `<workbook xmlns="${X}" xmlns:r="${R}"><sheets><sheet name="Сводка" sheetId="1" r:id="rA"/><sheet name="Архив" sheetId="2" r:id="rB"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rA" Target="worksheets/first.xml"/><Relationship Id="rB" Target="worksheets/second.xml"/></Relationships>`,
  'xl/sharedStrings.xml': `<sst xmlns="${X}"><si><t>Доход</t></si></sst>`,
  'xl/worksheets/first.xml': `<worksheet xmlns="${X}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"/><c r="C1"><f>6*7</f><v>42</v></c><c r="D1" t="b"/></row></sheetData></worksheet>`,
  'xl/worksheets/second.xml': `<worksheet xmlns="${X}"><sheetData><row r="4"><c r="B4" t="inlineStr"><is><t>Архивный лист</t></is></c></row></sheetData></worksheet>`,
});

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({viewport:{width:1440,height:960}});
    await page.addInitScript(() => {
      const Audio = window.AudioContext;
      if (!Audio) return;
      window.AudioContext = class extends Audio {
        async resume() {
          await super.resume();
          window.greenosChimes = (window.greenosChimes || 0) + 1;
        }
      };
    });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error); });
    const start = page.getByRole('button',{name:'Меню приложений',exact:true});
    const close = async win => { await win.getByRole('button',{name:'Закрыть',exact:true}).click(); await win.waitFor({state:'detached'}); };
    async function launch(term) {
      await start.click();
      await page.locator('#app-search').fill(term);
      await page.locator('.launcher-app').click();
    }
    async function upload(button, name, mimeType, buffer) {
      const chooser = page.waitForEvent('filechooser');
      await button.click();
      await (await chooser).setFiles({name,mimeType,buffer});
    }

    await page.goto(baseURL);
    await page.locator('#unlock').waitFor();
    assert.ok(await page.locator('#workarea').evaluate(node=>node.inert));
    fs.mkdirSync('test-results',{recursive:true});
    await page.screenshot({path:'test-results/greenos-startup-lock.png',animations:'disabled'});
    await unlockDesktop(page);
    if (await page.evaluate(()=>Boolean(window.AudioContext))) {
      await page.waitForFunction(()=>window.greenosChimes===1);
    }
    await page.reload();
    await page.locator('#unlock').waitFor();
    await page.locator('#startup-sound').click();
    assert.equal(await page.locator('#startup-sound').getAttribute('aria-pressed'),'false');
    await unlockDesktop(page);
    await page.locator('#start-button .shell-logo svg').waitFor();
    await close(page.locator('.os-window[data-app="welcome"]'));
    const palette = () => page.evaluate(() => ['.panel','.topbar','.desktop-icon .app-icon'].map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return [style.backgroundColor, style.backgroundImage, style.color].join(' ');
    }));
    const dark = await palette();
    await launch('Настройки');
    const settings = page.locator('.os-window[data-app="settings"]');
    await settings.locator('.theme-choice').selectOption('light');
    await page.waitForTimeout(190);
    const light = await palette();
    assert.ok(light.every((value,index) => value !== dark[index]));
    await settings.getByRole('button',{name:'Цвет #bdabe4'}).click();
    await page.waitForTimeout(190);
    assert.ok((await palette()).every((value,index) => value !== light[index]));
    const avatar = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 56;
      const context = canvas.getContext('2d');
      context.fillStyle = '#356b80';
      context.fillRect(0,0,80,56);
      context.fillStyle = '#f4ead2';
      context.fillRect(26,12,28,28);
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await upload(settings.getByRole('button',{name:'Добавить обои'}), 'Мои обои.png', 'image/png', avatar);
    await page.waitForFunction(()=>document.querySelector('#desktop').dataset.wallpaper==='custom');
    assert.match(await page.locator('.landscape').evaluate(node=>node.style.backgroundImage),/^url\("blob:/);
    await settings.locator('[data-tab="user"]').click();
    await upload(settings.getByRole('button',{name:'Выбрать изображение'}), 'avatar.png', 'image/png', avatar);
    await settings.locator('.profile-avatar img').waitFor();
    await close(settings);
    await start.click();
    await page.locator('#launcher-avatar img').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#lock').click();
    assert.ok(await page.locator('#workarea').evaluate(node => node.inert));
    await page.locator('.lock-avatar img').waitFor();
    await unlockDesktop(page);
    await page.locator('#workarea').click({button:'right',position:{x:440,y:100}});
    await page.getByRole('menuitem',{name:'Добавить ярлык приложения…'}).click();
    await page.locator('#app-search').fill('Калькулятор');
    await page.locator('.launcher-app').click();
    const shortcut = page.locator('[data-shortcut="app:calculator"]');
    await shortcut.waitFor();
    const box = await shortcut.boundingBox();
    const target = await page.locator('#desktop-icons').evaluate(root => {
      const style = getComputedStyle(root), bounds = root.getBoundingClientRect();
      return {x:bounds.left + parseFloat(style.getPropertyValue('--shortcut-width')) * 2.5,
        y:bounds.top + parseFloat(style.getPropertyValue('--shortcut-height')) * 1.5};
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x,target.y,{steps:12});
    await page.mouse.up();
    assert.equal(await shortcut.getAttribute('data-col'),'2');
    assert.equal(await shortcut.getAttribute('data-row'),'1');
    assert.equal(await page.locator('.os-window[data-app="calculator"]').count(),0);

    await start.click();
    await page.locator('#launcher-avatar img').waitFor();
    await page.screenshot({path:'test-results/greenos-personalization.png',animations:'disabled'});
    await page.reload();
    await page.locator('#startup-sound').waitFor();
    assert.equal(await page.locator('#startup-sound').getAttribute('aria-pressed'),'false');
    await unlockDesktop(page);
    await page.waitForFunction(()=>document.querySelector('#desktop').dataset.wallpaper==='custom');
    await shortcut.waitFor();
    assert.equal(await shortcut.getAttribute('data-col'),'2');
    await start.click();
    await page.locator('#launcher-avatar img').waitFor();
    await page.locator('#launcher-avatar').click();
    await settings.getByRole('button',{name:'Удалить аватар'}).click();
    await settings.locator('.profile-avatar img').waitFor({state:'detached'});
    await settings.locator('[data-tab="appearance"]').click();
    await settings.locator('.custom-wallpaper-remove').click();
    await page.waitForFunction(()=>document.querySelector('#desktop').dataset.wallpaper==='hills');
    await close(settings);
    // Restoring the welcome window may obscure the shortcut after a reload.
    const welcome = page.locator('.os-window[data-app="welcome"]');
    if (await welcome.count()) await close(welcome);
    await shortcut.click({button:'right'});
    await page.getByRole('menuitem',{name:'Убрать ярлык'}).click();
    await shortcut.waitFor({state:'detached'});
    console.log('PASS: startup chime and lock, wallpaper persistence, shell theme, avatar and shortcuts');

    await launch('Документы');
    const office = page.locator('.os-window[data-app="office"]');
    const open = office.getByRole('button',{name:'Открыть файл…'});
    await upload(open, 'Отчёт.docx','application/octet-stream',word(avatar));
    await office.getByRole('heading',{name:'Отчёт GreenOS'}).waitFor();
    await office.getByRole('cell',{name:'<script> безопасный текст'}).waitFor();
    assert.equal(await office.locator('.office-word img').count(), 1);
    await page.waitForFunction(() => document.querySelector('.office-word img')?.naturalWidth === 80);
    await office.getByRole('button',{name:'Сохранить в Документы'}).click();
    await page.locator('#toast-area').getByText('Документ сохранён в папку «Документы».',{exact:true}).waitFor();
    await upload(open, 'Повреждённый.docx','application/octet-stream',Buffer.from('not an Office archive'));
    await office.getByText('Повреждённый или неподдерживаемый архив Office.',{exact:true}).waitFor();
    assert.ok(await office.getByRole('button',{name:'Скачать оригинал'}).isVisible());
    await upload(open, 'Презентация.pptx','application/octet-stream',slides);
    await office.getByText('Первый слайд',{exact:true}).waitFor();
    await office.getByRole('button',{name:'Следующий',exact:true}).click();
    await office.getByText('Второй слайд',{exact:true}).waitFor();
    await office.getByRole('button',{name:'Редактировать копию',exact:true}).click();
    await office.locator('.office-slide-text textarea').first().fill('Изменённый слайд');
    await office.getByRole('button',{name:'Сохранить копию',exact:true}).click();
    await office.getByText('PPTX · Сохранено',{exact:true}).waitFor();
    await office.getByRole('button',{name:'К оригиналу',exact:true}).click();
    await office.getByText('Первый слайд',{exact:true}).waitFor();
    await upload(open, 'Таблица.xlsx','application/octet-stream',book);
    await office.getByRole('cell',{name:'Доход',exact:true}).waitFor();
    assert.equal(await office.getByRole('cell',{name:'42',exact:true}).getAttribute('title'),'=6*7');
    assert.deepEqual(await office.locator('.office-sheet tbody td').allTextContents(), ['Доход','','42','']);
    await office.getByRole('combobox',{name:'Выбор листа'}).selectOption({label:'Архив'});
    await office.getByRole('cell',{name:'Архивный лист'}).waitFor();
    await office.getByRole('button',{name:'Редактировать копию',exact:true}).click();
    await office.getByRole('textbox',{name:'Значение ячейки'}).fill('Новая строка');
    await office.getByRole('button',{name:'Сохранить копию',exact:true}).click();
    await office.getByText('XLSX · Сохранено',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(async () => {
      const {fs} = await import('/assets/storage.js');
      const {OfficePackage,descendants} = await import('/assets/office-package.js');
      const files = fs.list('documents');
      const presentation = new OfficePackage(files.find(file => file.name === 'Презентация — копия.pptx').data);
      const workbook = new OfficePackage(files.find(file => file.name === 'Таблица — копия.xlsx').data);
      return [descendants(await presentation.xml('ppt/slides/b.xml'),'t')[0].textContent,
        descendants(await workbook.xml('xl/worksheets/first.xml'),'t')[0].textContent];
    }),['Изменённый слайд','Новая строка']);
    await office.getByRole('button',{name:'Новая книга Excel',exact:true}).click();
    await office.locator('.window-name').getByText('Новая книга.xlsx',{exact:true}).waitFor();
    const cellValue = office.getByRole('textbox',{name:'Значение ячейки'});
    await cellValue.fill('21');
    await office.getByRole('button',{name:'Применить',exact:true}).click();
    await office.locator('[data-cell="A1"]').getByText('21',{exact:true}).waitFor();
    await office.locator('[data-cell="B1"]').click();
    await cellValue.fill('=A1*2');
    await office.getByRole('button',{name:'Сохранить XLSX',exact:true}).click();
    await office.getByText('XLSX · Сохранено',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(async ()=>{
      const {fs} = await import('/assets/storage.js');
      const {OfficePackage,descendants} = await import('/assets/office-package.js');
      const file = fs.list('documents').find(node=>node.name==='Новая книга.xlsx');
      const xml = await new OfficePackage(file.data).xml('xl/worksheets/sheet1.xml');
      return [descendants(xml,'f')[0].textContent,...descendants(xml,'v').map(item=>item.textContent)];
    }),['A1*2','21','42']);
    await upload(open,'Пример.pdf','application/pdf',pdfFixture());
    if (await page.evaluate(() => navigator.pdfViewerEnabled)) {
      await office.locator('iframe.office-pdf').waitFor();
      const frame = office.locator('iframe.office-pdf');
      assert.match(await frame.getAttribute('src'), /^blob:/);
      await page.waitForTimeout(450);
      await office.screenshot({path:'test-results/greenos-pdf.png',animations:'disabled'});
    } else await office.getByText(/Встроенный просмотр PDF.*недоступен/).waitFor();
    await close(office);
    await page.locator('[data-shortcut="home:home"]').click();
    const files = page.locator('.os-window[data-app="files"]');
    await files.locator('[data-folder="documents"]').click();
    const report = files.getByRole('button',{name:'Отчёт.docx',exact:true});
    await report.click({button:'right'});
    await page.getByRole('menuitem',{name:'Создать ярлык на рабочем столе'}).click();
    await report.dblclick();
    await office.getByRole('heading',{name:'Отчёт GreenOS'}).waitFor();
    await page.screenshot({path:'test-results/greenos-documents.png',animations:'disabled'});
    await close(office);
    await close(files);
    await page.locator('.desktop-icon[data-shortcut^="file:"]').getByText('Отчёт.docx').click();
    await office.getByRole('heading',{name:'Отчёт GreenOS'}).waitFor();
    await close(office);
    await page.locator('.desktop-icon[data-shortcut^="file:"]').click({button:'right'});
    await page.getByRole('menuitem',{name:'Убрать ярлык'}).click();
    await page.locator('.desktop-icon[data-shortcut^="file:"]').waitFor({state:'detached'});
    assert.ok(await page.evaluate(async () => {
      const {fs} = await import('/assets/storage.js');
      return fs.list('documents').some(node => node.name === 'Отчёт.docx');
    }));
    console.log('PASS: local DOCX, PPTX, XLSX, PDF, file-manager routing and file shortcuts');

    await launch('Реверси');
    const games = page.locator('.os-window[data-app="games"]');
    await games.getByRole('button',{name:'Реверси',exact:true}).click();
    const legal = games.locator('.reversi-cell.legal');
    assert.equal(await legal.count(),4);
    await legal.first().click();
    assert.equal(await games.locator('.reversi-cell[data-piece]:not([data-piece="0"])').count(),6);
    await games.getByRole('button',{name:'Пятнашки',exact:true}).click();
    await games.locator('.fifteen-board .movable').first().click();
    await games.getByText('Ходы: 1',{exact:true}).waitFor();
    await games.locator('[data-game="galaxy"]').click();
    const galaxy = page.locator('.os-window[data-app="galaxy"]');
    await galaxy.getByRole('button',{name:'Начать полёт',exact:true}).click();
    assert.equal(await games.locator('.galaxy-cabinet').count(),0);
    await galaxy.locator('.galaxy-overlay').waitFor({state:'hidden'});
    await page.keyboard.press('KeyP');
    await galaxy.getByRole('button',{name:'Продолжить',exact:true}).waitFor();
    const galaxyTheme = () => galaxy.locator('.galaxy-content').evaluate(node=>node.style.cssText);
    const previousTheme = await galaxyTheme();
    await page.evaluate(async ()=>{
      const {settings} = await import('/assets/core.js');
      settings.set({accent:'#8fcac5',theme:'dark'});
    });
    assert.notEqual(await galaxyTheme(),previousTheme);
    await close(galaxy);
    await games.getByRole('button',{name:'Пятнашки',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(120);
    assert.ok(await page.locator('.panel').evaluate(panel => panel.getBoundingClientRect().right <= innerWidth));
    assert.ok(await games.locator('.fifteen-board').evaluate(board => board.getBoundingClientRect().right <= innerWidth));
    assert.deepEqual(errors,[]);
    console.log('PASS: Reversi, sliding puzzle, Galaxy start and pause, and narrow viewport');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
