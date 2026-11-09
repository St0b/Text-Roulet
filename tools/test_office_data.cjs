const assert = require('node:assert/strict');
const {chromium, launchOptions, baseURL} = require('./browser_test_support.cjs');

const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pack = 'http://schemas.openxmlformats.org/package/2006/relationships';
const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const relations = items => `<Relationships xmlns="${pack}">${items.map(([id, type, target]) =>
  `<Relationship Id="${id}" Type="${rel}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

const sheets = {
  'xl/workbook.xml': `<workbook xmlns="${spreadsheet}" xmlns:r="${rel}"><sheets>
    <sheet name="Лист один" sheetId="1" r:id="s1"/><sheet name="Лист два" sheetId="2" r:id="s2"/>
  </sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': relations([['s1','worksheet','worksheets/sheet1.xml'],
    ['s2','worksheet','worksheets/sheet2.xml'], ['strings','sharedStrings','sharedStrings.xml']]),
  'xl/sharedStrings.xml': `<sst xmlns="${spreadsheet}"><si><t>Строка</t></si></sst>`,
  'xl/worksheets/sheet1.xml': `<worksheet xmlns="${spreadsheet}"><dimension ref="A1:D7"/><sheetData>
    <row r="1" spans="1:2"><c r="A1"><f>SUM(1,2)</f><v>3</v></c><c r="B1" t="s" s="3"><v>0</v></c></row>
    <row r="7"><c r="A7"><v>10</v></c><c r="B7" t="inlineStr"><is><t>Строка_x000D_Новая</t></is></c></row>
  </sheetData><mergeCells count="1"><mergeCell ref="C2:D2"/></mergeCells></worksheet>`,
  'xl/worksheets/sheet2.xml': `<worksheet xmlns="${spreadsheet}"><sheetData>
    <row r="1"><c r="A1" t="b"><v>1</v></c></row>
  </sheetData><sheetProtection sheet="1"/></worksheet>`,
};

const slide = name => `<p:sld xmlns:p="${presentation}" xmlns:a="${drawing}"><p:cSld><p:spTree><p:sp>
  <p:nvSpPr><p:cNvPr id="2" name="Заголовок"/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="1200" y="2400"/></a:xfrm></p:spPr>
  <p:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>${name}</a:t></a:r>
  <a:r><a:rPr i="1"/><a:t> слайд</a:t></a:r><a:fld><a:t>Поле</a:t></a:fld></a:p></p:txBody>
</p:sp></p:spTree></p:cSld></p:sld>`;
const slides = {
  'ppt/presentation.xml': `<p:presentation xmlns:p="${presentation}" xmlns:r="${rel}"><p:sldIdLst>
    <p:sldId id="256" r:id="one"/><p:sldId id="257" r:id="two"/>
  </p:sldIdLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': relations([['one','slide','slides/slide1.xml'], ['two','slide','slides/slide2.xml']]),
  'ppt/slides/slide1.xml': slide('Первый'),
  'ppt/slides/slide2.xml': slide('Второй'),
  'ppt/media/sample.bin': 'оригинальные данные',
};

async function openEditor(page, format, parts) {
  await page.evaluate(async ({format,parts}) => {
    const {writeOfficeZip, OfficePackage} = await import('/assets/office-package.js');
    const {createOfficeDataEditor} = await import('/assets/office-data-editor.js');
    const data = await writeOfficeZip(new Map(Object.entries(parts)));
    const node = {name:`Проверка.${format}`, data};
    window.dataEditor = await createOfficeDataEditor(node, format, {onChange:() => window.dataEdits++});
    window.dataEdits = 0;
    window.readPart = async part => {
      const archive = new OfficePackage(await window.dataEditor.build());
      return new TextDecoder().decode(await archive.read(part));
    };
    document.body.replaceChildren(window.dataEditor.element);
  }, {format,parts});
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage();
    await page.goto(baseURL);
    await openEditor(page, 'xlsx', sheets);
    const value = page.getByRole('textbox', {name:'Значение ячейки'});
    const type = page.getByRole('combobox', {name:'Тип значения'});
    const cell = address => page.locator(`[data-cell="${address}"]`);
    assert.equal(await value.getAttribute('readonly'), '');
    assert.equal(await page.evaluate(() => window.dataEdits), 0);
    await cell('D2').click();
    assert.equal(await value.getAttribute('readonly'), '');
    await cell('B7').click();
    await cell('B1').click();
    await value.fill(' =2+3 ');
    await page.getByRole('button', {name:'Применить'}).click();
    await cell('C1').click();
    await type.selectOption('number');
    await value.fill('Ошибка');
    await assert.rejects(page.evaluate(() => window.dataEditor.build()), /Исправьте значение/);
    await value.fill('1,25');
    await value.press('Enter');
    await cell('A5').click();
    await value.fill('пять');
    await value.press('Enter');
    await cell('A3').click();
    await value.fill('три');
    await value.press('Enter');
    const address = page.getByRole('textbox', {name:'Адрес ячейки'});
    await address.fill('J21');
    await page.getByRole('button', {name:'Перейти'}).click();
    await value.fill('4');
    await page.getByRole('combobox', {name:'Лист для редактирования'}).selectOption('1');
    await page.getByText('На листе включена защита.').waitFor();
    const read = path => page.evaluate(path => window.readPart(path), path);
    const xml = await read('xl/worksheets/sheet1.xml');
    assert.match(xml, /<f>SUM\(1,2\)<\/f><v>3<\/v>/);
    assert.match(xml, /<c r="B1" s="3" t="inlineStr"><is><t xml:space="preserve"> =2\+3 <\/t><\/is><\/c>/);
    assert.match(xml, /<c r="C1"><v>1\.25<\/v><\/c>/);
    assert.match(xml, /Строка_x000D_Новая/);
    assert.match(xml, /<dimension ref="A1:J21"/);
    assert.deepEqual([...xml.matchAll(/<row r="(\d+)"/g)].map(match => match[1]), ['1','3','5','7','21']);
    assert.equal(await read('xl/worksheets/sheet2.xml'), sheets['xl/worksheets/sheet2.xml']);
    assert.equal(await read('xl/sharedStrings.xml'), sheets['xl/sharedStrings.xml']);
    console.log('PASS: XLSX edits, validates numbers and preserves formulas, styles, protected sheets and shared strings');

    await openEditor(page, 'pptx', slides);
    await page.getByRole('textbox', {name:'Заголовок, фрагмент 1'}).fill('Исправленный <текст>');
    await page.getByRole('button', {name:'Следующий слайд'}).click();
    await page.getByRole('textbox', {name:'Заголовок, фрагмент 2'}).fill(' экран');
    await page.getByRole('button', {name:'Предыдущий слайд'}).click();
    assert.equal(await page.getByRole('textbox', {name:'Заголовок, фрагмент 1'}).inputValue(), 'Исправленный <текст>');
    const first = await read('ppt/slides/slide1.xml');
    const second = await read('ppt/slides/slide2.xml');
    assert.match(first, /<a:rPr b="1"\s*\/><a:t>Исправленный &lt;текст&gt;<\/a:t>/);
    assert.match(first, /<a:off x="1200" y="2400"/);
    assert.match(first, /<a:fld><a:t>Поле<\/a:t><\/a:fld>/);
    assert.match(second, /<a:rPr i="1"\s*\/><a:t> экран<\/a:t>/);
    assert.equal(await read('ppt/media/sample.bin'), slides['ppt/media/sample.bin']);
    console.log('PASS: PPTX navigation, text round-trip, XML escaping, run styles, geometry and media');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
