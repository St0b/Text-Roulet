const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, launchOptions, baseURL, unlockDesktop} = require('./browser_test_support.cjs');

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error); });
    await page.goto(baseURL);
    await unlockDesktop(page);
    await page.getByRole('heading',{name:'Ваш рабочий стол. Теперь с Linux.'}).waitFor({timeout:30000});
    await page.getByRole('button',{name:'Меню приложений',exact:true}).click();
    await page.locator('#app-search').fill('Документы');
    await page.locator('.launcher-app').click();
    const app = page.locator('.os-window[data-app="office"]');
    const paper = app.getByRole('textbox',{name:'Текст документа',exact:true});
    const title = app.getByRole('textbox',{name:'Имя документа',exact:true});
    const font = app.getByRole('combobox',{name:'Шрифт',exact:true});
    const size = app.getByRole('spinbutton',{name:'Размер шрифта, пт'});
    const toast = page.locator('#toast-area');
    const waitSaved = () => app.getByText(/^DOCX · Сохранено$/).waitFor();
    const close = async () => {
      await app.getByRole('button',{name:'Закрыть',exact:true}).click();
      await app.waitFor({state:'detached'});
    };
    const selectText = value => paper.evaluate((root,value) => {
      const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const start = node.data.indexOf(value);
        if (start < 0) continue;
        root.focus();
        const selection = getSelection(), range = document.createRange();
        range.setStart(node,start);
        range.setEnd(node,start + value.length);
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        return;
      }
      throw new Error('Cannot select ' + value);
    }, value);
    const atEnd = () => paper.evaluate(root => {
      root.focus();
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await app.getByRole('button',{name:'Создать DOCX',exact:true}).click();
    await title.fill('Проверка Word');
    await paper.click();
    await page.keyboard.insertText('Размер текста и остальной абзац');
    await selectText('Размер текста');
    await font.selectOption('Georgia');
    await size.fill('22.5');
    await size.press('Enter');
    await app.getByRole('button',{name:'Полужирный',exact:true}).click();
    await app.getByRole('button',{name:'По центру',exact:true}).click();
    await app.getByRole('combobox',{name:'Межстрочный интервал'}).selectOption('1.5');
    assert.ok(await paper.evaluate(root => [...root.querySelectorAll('span')].some(span =>
      span.style.fontSize === '22.5pt' && span.textContent === 'Размер текста')));
    await app.getByRole('button',{name:'Отменить',exact:true}).click();
    await app.getByRole('button',{name:'Повторить',exact:true}).click();

    const alignments = () => paper.evaluate(root => [...root.children].map(block => getComputedStyle(block).textAlign));
    const original = await alignments();
    assert.deepEqual(original,['center']);
    await selectText('Размер текста');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    assert.deepEqual(await alignments(),['left','center']);
    await page.keyboard.press('Control+z');
    await selectText('и остальной');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.deepEqual(await alignments(),['center','left']);
    await page.keyboard.press('Control+z');
    await selectText('и остальной абзац');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+Enter');
    assert.deepEqual(await alignments(),original);
    await page.keyboard.press('Control+z');
    await selectText('и остальной абзац');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.deepEqual(await alignments(),['center','left']);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await alignments(),original);
    await page.keyboard.press('Control+y');
    assert.deepEqual(await alignments(),['center','left']);
    await page.keyboard.insertText('Первый пункт');
    await app.getByRole('button',{name:'Нумерованный список',exact:true}).click();
    await paper.locator('ol li').getByText('Первый пункт',{exact:true}).waitFor();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await app.getByRole('button',{name:'Вставить таблицу',exact:true}).click();
    await page.locator('#system-dialog input').fill('2×3');
    await page.locator('#system-dialog').getByRole('button',{name:'Вставить',exact:true}).click();
    await paper.locator('table').waitFor();
    assert.equal(await paper.locator('td').count(),6);
    await atEnd();

    const png = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 70; canvas.height = 35;
      const context = canvas.getContext('2d');
      context.fillStyle = '#638379'; context.fillRect(0,0,70,35);
      return canvas.toDataURL('image/png').split(',')[1];
    }),'base64');
    const chooser = page.waitForEvent('filechooser');
    await app.getByRole('button',{name:'Вставить изображение',exact:true}).click();
    await (await chooser).setFiles({name:'illustration.png',mimeType:'image/png',buffer:png});
    await page.waitForFunction(() => document.querySelector('.word-paper img')?.naturalWidth === 70);
    await atEnd();
    await page.keyboard.press('Enter');
    await size.fill('18');
    await size.press('Enter');
    await app.getByRole('button',{name:'Полужирный',exact:true}).click();
    await page.keyboard.insertText('Стиль при вводе');
    assert.ok(await paper.evaluate(root => [...root.querySelectorAll('span')].some(span =>
      span.style.fontSize === '18pt' && span.style.fontWeight === 'bold' && span.textContent === 'Стиль при вводе')));
    await atEnd();
    await page.keyboard.press('Control+Enter');
    await page.keyboard.insertText('Отдельная вторая страница');
    await page.keyboard.press('Control+f');
    await app.getByRole('searchbox',{name:'Что найти'}).fill('Отдельная');
    await app.getByRole('textbox',{name:'На что заменить'}).fill('Заголовок');
    await app.getByRole('button',{name:'Заменить все',exact:true}).click();
    await app.getByText('Заменено: 1',{exact:true}).waitFor();
    await app.getByRole('button',{name:'Закрыть поиск',exact:true}).click();
    assert.match(await paper.textContent(),/Заголовок вторая страница/);
    await app.getByText(/Страница [12] из 2/).waitFor();
    assert.equal(await app.locator('.word-page-mat').count(),2);
    await app.getByRole('combobox',{name:'Вид страниц'}).selectOption('spread');
    await app.getByText('Страницы 1–2 из 2',{exact:true}).waitFor();
    fs.mkdirSync('test-results',{recursive:true});
    await app.screenshot({path:'test-results/greenos-word-editor.png',animations:'disabled'});
    await page.keyboard.press('Control+s');
    await waitSaved();

    const inspect = name => page.evaluate(async name => {
      const {fs} = await import('/assets/storage.js');
      const {OfficePackage,descendants,attribute,child} = await import('/assets/office-package.js');
      const node = fs.list('documents').find(file => file.name === name);
      if (!node) return null;
      const zip = new OfficePackage(node.data);
      const path = await zip.rootPart('word/document.xml');
      const doc = await zip.xml(path);
      const text = descendants(doc,'t').map(t => t.textContent).join(' ');
      const run = descendants(doc,'r').find(r => descendants(r,'t').some(t => t.textContent === 'Размер текста'));
      const props = child(run,'rPr');
      return {id:node.id,text, halfPoints:attribute(child(props,'sz'),'val'), font:attribute(child(props,'rFonts'),'ascii'),
        bold:Boolean(child(props,'b')) && attribute(child(props,'b'),'val') !== '0',
        align:descendants(doc,'jc').map(jc => attribute(jc,'val')),
        spacing:descendants(doc,'spacing').map(item => attribute(item,'line')),
        lists:descendants(doc,'numId').length, cells:descendants(doc,'tc').length,
        images:descendants(doc,'drawing').length, breaks:descendants(doc,'br').filter(br => attribute(br,'type') === 'page').length,
        packageType:(await zip.xml('[Content_Types].xml')).localName};
    },name);
    const saved = await inspect('Проверка Word.docx');
    assert.equal(saved.halfPoints,'45');
    assert.equal(saved.font,'Georgia');
    assert.equal(saved.bold,true);
    assert.ok(saved.align.includes('center'));
    assert.ok(saved.spacing.includes('360'));
    assert.equal(saved.lists,1);
    assert.equal(saved.cells,6);
    assert.equal(saved.images,1);
    assert.equal(saved.breaks,1);
    assert.equal(saved.packageType,'Types');
    const downloading = page.waitForEvent('download');
    await app.getByRole('button',{name:'Скачать DOCX',exact:true}).click();
    assert.equal((await downloading).suggestedFilename(),'Проверка Word.docx');
    await close();
    await page.evaluate(async id => {
      const {wm} = await import('/assets/windows.js');
      await wm.open('office',{id});
    },saved.id);
    await app.locator('.office-word').getByText('Размер текста',{exact:true}).waitFor();
    assert.equal(await app.locator('.office-word').getByText('Размер текста',{exact:true}).evaluate(node => node.style.fontSize),'22.5pt');
    await app.locator('.office-word ol').getByText('Первый пункт',{exact:true}).waitFor();
    await app.getByText(/Страница [12] из 2/).waitFor();
    await page.waitForFunction(() => document.querySelector('.office-word img')?.naturalWidth === 70);
    await app.getByRole('button',{name:'Редактировать копию',exact:true}).click();
    await atEnd();
    await page.keyboard.insertText(' Изменено');
    await app.getByRole('button',{name:'Закрыть',exact:true}).click();
    await page.locator('#system-dialog').getByText('Закрыть редактирование?',{exact:true}).waitFor();
    await page.locator('#system-dialog').getByRole('button',{name:'Отмена',exact:true}).click();
    await app.getByRole('button',{name:'Сохранить DOCX',exact:true}).click();
    await waitSaved();
    const copy = await inspect('Проверка Word — копия.docx');
    assert.ok(copy.text.includes('Изменено'));
    assert.equal((await inspect('Проверка Word.docx')).text,saved.text);
    await app.getByRole('button',{name:'Новый документ Word',exact:true}).click();
    await paper.evaluate(root => {
      const paragraphs = Array.from({length:85},(_,index) => {
        const paragraph = document.createElement('p');
        paragraph.textContent = `Абзац ${index + 1}. Автоматическая разбивка длинного текста на страницы.`;
        return paragraph;
      });
      root.replaceChildren(...paragraphs);
      root.dispatchEvent(new InputEvent('input',{inputType:'insertText',bubbles:true}));
    });
    await page.waitForFunction(() => document.querySelectorAll('.word-page-mat').length > 2);
    await app.getByRole('combobox',{name:'Вид страниц'}).selectOption('draft');
    await app.locator('.word-page-status').getByText('Черновик',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: DOCX formatting, automatic and manual pages, export, reopen, copy preservation and unsaved confirmation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
