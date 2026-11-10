const assert = require('node:assert/strict');
const {chromium, launchOptions, baseURL, unlockDesktop} = require('./browser_test_support.cjs');

const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pack = 'http://schemas.openxmlformats.org/package/2006/relationships';
const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const relations = items => `<Relationships xmlns="${pack}">${items.map(([id, type, target]) =>
  `<Relationship Id="${id}" Type="${rel}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

const sheets = {
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>',
  'xl/workbook.xml': `<workbook xmlns="${spreadsheet}" xmlns:r="${rel}"><sheets>
    <sheet name="Лист один" sheetId="1" r:id="s1"/><sheet name="Лист два" sheetId="2" r:id="s2"/>
  </sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': relations([['s1','worksheet','worksheets/sheet1.xml'],
    ['s2','worksheet','worksheets/sheet2.xml'], ['strings','sharedStrings','sharedStrings.xml'], ['chain','calcChain','calcChain.xml']]),
  'xl/calcChain.xml': `<calcChain xmlns="${spreadsheet}"><c r="A1" i="1"/></calcChain>`,
  'xl/sharedStrings.xml': `<sst xmlns="${spreadsheet}"><si><t>Строка</t></si></sst>`,
  'xl/worksheets/sheet1.xml': `<worksheet xmlns="${spreadsheet}"><dimension ref="A1:D7"/><sheetData>
    <row r="1" spans="1:8"><c r="A1"><f>SUM(1,2)</f><v>3</v></c><c r="B1" t="s" s="3"><v>0</v></c>
    <c r="E1"><f>MEDIAN(A1:C1)</f><v>3</v></c><c r="F1"><f t="shared" ref="F1:G1" si="0">A1+1</f><v>4</v></c>
    <c r="G1"><f t="shared" si="0"/><v>5</v></c><c r="H1"><f t="array" ref="H1:H2">A1:A2*2</f><v>6</v></c></row>
    <row r="7"><c r="A7"><v>10</v></c><c r="B7" t="inlineStr"><is><t>Строка_x000D_Новая</t></is></c></row>
  </sheetData><mergeCells count="1"><mergeCell ref="C2:D2"/></mergeCells></worksheet>`,
  'xl/worksheets/sheet2.xml': `<worksheet xmlns="${spreadsheet}"><sheetData>
    <row r="1"><c r="A1" t="b"><v>1</v></c></row>
  </sheetData><sheetProtection sheet="1"/></worksheet>`,
};

const styledSheets = {
  ...sheets,
  '[Content_Types].xml': sheets['[Content_Types].xml'].replace('</Types>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
  'xl/_rels/workbook.xml.rels': sheets['xl/_rels/workbook.xml.rels'].replace('</Relationships>',
    `<Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`),
  'xl/styles.xml': `<styleSheet xmlns="${spreadsheet}">
    <fonts count="2"><font><name val="Calibri"/><sz val="11"/></font>
      <font><name val="Cambria"/><sz val="14"/><i/><color rgb="FF338899"/></font></fonts>
    <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
    <borders count="1"><border/></borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
      <xf numFmtId="4" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1">
        <alignment horizontal="right"/></xf></cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  'xl/worksheets/sheet1.xml': sheets['xl/worksheets/sheet1.xml']
    .replace('A1:D7','A1:AA45')
    .replace('<sheetData>','<cols><col min="2" max="4" width="18" customWidth="1"/></cols><sheetData>')
    .replace('</sheetData>','<row r="45"><c r="AA45" t="inlineStr"><is><t>Ниже и правее</t></is></c></row></sheetData>'),
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

async function openEditor(page, format, parts, restoreDraft = false) {
  await page.evaluate(async ({format,parts,restoreDraft}) => {
    const {writeOfficeZip, OfficePackage} = await import('/assets/office-package.js');
    const {createOfficeDataEditor} = await import('/assets/office-data-editor.js');
    const data = await writeOfficeZip(new Map(Object.entries(parts)));
    const node = {name:`Проверка.${format}`, data};
    const draft = restoreDraft ? structuredClone(window.dataEditor.captureDraft()) : undefined;
    window.dataEditor = await createOfficeDataEditor(node, format, {draft,onChange:() => window.dataEdits++});
    window.dataEdits = 0;
    window.readPart = async part => {
      const archive = new OfficePackage(await window.dataEditor.build());
      const data = await archive.read(part);
      return data ? new TextDecoder().decode(data) : null;
    };
    document.querySelector('#desktop').hidden = true;
    let mount = document.querySelector('#office-data-test-root');
    if (!mount) {
      mount = document.createElement('main');
      mount.id = 'office-data-test-root';
      Object.assign(mount.style,{display:'flex',height:'100dvh'});
      document.body.append(mount);
    }
    mount.replaceChildren(window.dataEditor.element);
  }, {format,parts,restoreDraft});
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(baseURL);
    await unlockDesktop(page);
    await openEditor(page, 'xlsx', sheets);
    const value = page.getByRole('textbox', {name:'Значение ячейки'});
    const type = page.getByRole('combobox', {name:'Тип значения'});
    const cell = address => page.locator(`[data-cell="${address}"]`);
    const read = path => page.evaluate(path => window.readPart(path), path);
    assert.equal(await value.getAttribute('readonly'), null);
    assert.equal(await value.inputValue(), '=SUM(1,2)');
    assert.equal(await cell('A1').textContent(), '3');
    assert.equal(await page.evaluate(() => window.dataEdits), 0);
    assert.equal(await read('xl/workbook.xml'), sheets['xl/workbook.xml']);
    await cell('D2').click();
    assert.equal(await value.getAttribute('readonly'), '');
    await cell('G1').click();
    assert.equal(await value.getAttribute('readonly'), '');
    await cell('H2').click();
    assert.equal(await value.getAttribute('readonly'), '');
    await cell('E1').click();
    await page.getByText('Функция MEDIAN пока недоступна в GreenOS.', {exact:true}).waitFor();
    assert.equal(await value.inputValue(), '=MEDIAN(A1:C1)');
    assert.equal(await cell('E1').textContent(), '3');
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
    assert.equal(await read('xl/calcChain.xml'), sheets['xl/calcChain.xml']);
    await cell('A1').click();
    await value.fill('=СУММ(C1;A7)*2');
    await value.press('Enter');
    assert.equal(await cell('A1').textContent(), '22.5');
    await cell('D1').click();
    await value.fill('=AVERAGE(A1;C1)+MIN($C$1;A7)+MAX(A7;C1)+COUNT(B1:C1)');
    await value.press('Enter');
    assert.equal(await cell('D1').textContent(), '24.125');
    await cell('C1').click();
    await value.fill('2,5');
    await value.press('Enter');
    assert.equal(await cell('A1').textContent(), '25');
    assert.equal(await cell('D1').textContent(), '27.25');
    await cell('I1').click();
    await value.fill('=I1+1');
    await value.press('Enter');
    await page.getByText('Циклическая ссылка.', {exact:true}).waitFor();
    assert.equal(await cell('I1').textContent(), 'Цикл');
    await cell('I2').click();
    await value.fill('=1/0');
    await value.press('Enter');
    assert.equal(await cell('I2').textContent(), '#DIV/0!');
    await cell('I3').click();
    await value.fill('=MEDIAN(1,2)');
    await value.press('Enter');
    await page.getByText('Функция MEDIAN пока недоступна в GreenOS.', {exact:true}).waitFor();
    await assert.rejects(page.evaluate(() => window.dataEditor.build()), /Исправьте значение/);
    await value.press('Escape');
    assert.equal(await value.inputValue(), '');
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
    await cell('J21').press('Control+Home');
    await page.getByRole('combobox',{name:'Шрифт ячеек'}).selectOption('Arial');
    await page.getByRole('combobox', {name:'Лист для редактирования'}).selectOption('1');
    await page.getByText('На листе включена защита.').waitFor();
    const xml = await read('xl/worksheets/sheet1.xml');
    assert.match(xml, /<f>SUM\(C1,A7\)\*2<\/f><v>25<\/v>/);
    assert.match(xml, /<c r="B1" s="3" t="inlineStr"><is><t xml:space="preserve"> =2\+3 <\/t><\/is><\/c>/);
    assert.match(xml, /<c r="C1"><v>2\.5<\/v><\/c>/);
    assert.match(xml, /<f>AVERAGE\(A1,C1\)\+MIN\(\$C\$1,A7\)\+MAX\(A7,C1\)\+COUNT\(B1:C1\)<\/f><v>27\.25<\/v>/);
    assert.match(xml, /<f>MEDIAN\(A1:C1\)<\/f><v>3<\/v>/);
    assert.match(xml, /<f t="shared" ref="F1:G1" si="0">A1\+1<\/f><v>4<\/v>/);
    assert.match(xml, /<c r="I1"><f>I1\+1<\/f><\/c>/);
    assert.match(xml, /<c r="I2" t="e"><f>1\/0<\/f><v>#DIV\/0!<\/v><\/c>/);
    assert.match(xml, /Строка_x000D_Новая/);
    assert.match(xml, /<dimension ref="A1:J21"/);
    assert.deepEqual([...xml.matchAll(/<row r="(\d+)"/g)].map(match => match[1]), ['1','2','3','5','7','21']);
    assert.match(await read('xl/workbook.xml'), /<calcPr fullCalcOnLoad="1"\s*\/>/);
    assert.equal(await read('xl/calcChain.xml'), null);
    assert.doesNotMatch(await read('xl/_rels/workbook.xml.rels'), /calcChain/);
    assert.match(await read('xl/_rels/workbook.xml.rels'), /Type="[^"]*\/styles" Target="styles.xml"/);
    assert.match(await read('xl/styles.xml'), /name val="Arial"/);
    assert.doesNotMatch(await read('[Content_Types].xml'), /calcChain/);
    assert.match(await read('[Content_Types].xml'), /spreadsheetml.styles\+xml/);
    assert.equal(await read('xl/worksheets/sheet2.xml'), sheets['xl/worksheets/sheet2.xml']);
    assert.equal(await read('xl/sharedStrings.xml'), sheets['xl/sharedStrings.xml']);
    console.log('PASS: XLSX formulas, dependencies, ranges, diagnostics, cached values and lossless package edits');

    await openEditor(page,'xlsx',styledSheets);
    const font=page.getByRole('combobox',{name:'Шрифт ячеек'});
    const fontSize=page.getByRole('spinbutton',{name:'Размер шрифта ячеек, пт'});
    const bold=page.getByRole('button',{name:'Полужирный шрифт ячеек'});
    await cell('B1').click();
    assert.equal(await font.inputValue(),'Cambria');
    assert.equal(await fontSize.inputValue(),'14');
    await fontSize.fill('19');
    await fontSize.press('Enter');
    const columnB=page.getByRole('button',{name:'Выделить столбец B',exact:true});
    const columnC=page.getByRole('button',{name:'Выделить столбец C',exact:true});
    await columnB.click();
    await columnC.click({modifiers:['Shift']});
    assert.equal(await columnB.getAttribute('aria-pressed'),'true');
    assert.equal(await columnC.getAttribute('aria-pressed'),'true');
    await font.selectOption('Georgia');
    await bold.click();
    await openEditor(page,'xlsx',styledSheets,true);
    await cell('B1').click();
    assert.equal(await font.inputValue(),'Georgia');
    assert.equal(await fontSize.inputValue(),'19');
    assert.equal(await bold.getAttribute('aria-pressed'),'true');
    await cell('C4').click();
    assert.equal(await font.inputValue(),'Georgia');
    assert.equal(await bold.getAttribute('aria-pressed'),'true');
    await cell('D4').click();
    assert.equal(await font.inputValue(),'Calibri');
    const styles=await page.evaluate(async()=>{
      const parser=new DOMParser();
      const worksheet=parser.parseFromString(await window.readPart('xl/worksheets/sheet1.xml'),'application/xml');
      const styles=parser.parseFromString(await window.readPart('xl/styles.xml'),'application/xml');
      const styleId=Number(worksheet.querySelector('c[r="B1"]').getAttribute('s'));
      const xf=styles.querySelector('cellXfs').children[styleId];
      const font=styles.querySelector('fonts').children[Number(xf.getAttribute('fontId'))];
      return {
        numFmt:xf.getAttribute('numFmtId'),fill:xf.getAttribute('fillId'),align:xf.querySelector('alignment').getAttribute('horizontal'),
        italic:Boolean(font.querySelector('i')),color:font.querySelector('color').getAttribute('rgb'),
        columns:[...worksheet.querySelectorAll('col')].map(col=>['min','max','width','style'].map(attribute=>col.getAttribute(attribute))),
      };
    });
    assert.deepEqual({numFmt:styles.numFmt,fill:styles.fill,align:styles.align,italic:styles.italic,color:styles.color},
      {numFmt:'4',fill:'1',align:'right',italic:true,color:'FF338899'});
    assert.deepEqual(styles.columns.map(col=>col.slice(0,3)),[['2','2','18'],['3','3','18'],['4','4','18']]);
    assert.ok(styles.columns[0][3] && styles.columns[1][3]);
    assert.equal(styles.columns[2][3],null);
    assert.equal(await read('xl/workbook.xml'),styledSheets['xl/workbook.xml']);
    assert.equal(await read('xl/calcChain.xml'),styledSheets['xl/calcChain.xml']);

    await page.setViewportSize({width:490,height:720});
    await page.getByRole('button',{name:'Следующие строки'}).click();
    await page.getByText('Строки 19–36',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Следующие столбцы'}).click();
    await page.getByText('Столбцы J–R',{exact:true}).waitFor();
    await cell('M22').focus();
    await cell('M22').press('Control+End');
    await cell('AA45').waitFor();
    assert.equal(await cell('AA45').textContent(),'Ниже и правее');
    await value.fill('Строка 45 изменена');
    await value.press('Enter');
    await address.fill('XFD1048576');
    await address.press('Enter');
    await cell('XFD1048576').waitFor();
    assert.ok(await page.getByRole('button',{name:'Следующие строки'}).isDisabled());
    assert.ok(await page.getByRole('button',{name:'Следующие столбцы'}).isDisabled());
    await value.fill('Край листа');
    await value.press('Enter');
    const expanded=await read('xl/worksheets/sheet1.xml');
    assert.match(expanded,/<dimension ref="A1:XFD1048576"/);
    assert.match(expanded,/<c r="AA45" t="inlineStr"><is><t>Строка 45 изменена<\/t>/);
    assert.match(expanded,/<c r="XFD1048576" t="inlineStr"><is><t>Край листа<\/t>/);
    console.log('PASS: XLSX cell and column fonts, styled drafts and editing beyond the initial sheet page');

    await openEditor(page, 'pptx', slides);
    await page.getByRole('textbox', {name:'Заголовок, фрагмент 1'}).fill('Исправленный <текст>');
    await page.getByRole('button', {name:'Следующий слайд'}).click();
    await page.getByRole('textbox', {name:'Заголовок, фрагмент 2'}).fill(' экран');
    await openEditor(page, 'pptx', slides, true);
    assert.equal(await page.getByRole('textbox', {name:'Заголовок, фрагмент 2'}).inputValue(), ' экран');
    await page.getByRole('button', {name:'Предыдущий слайд'}).click();
    assert.equal(await page.getByRole('textbox', {name:'Заголовок, фрагмент 1'}).inputValue(), 'Исправленный <текст>');
    const first = await read('ppt/slides/slide1.xml');
    const second = await read('ppt/slides/slide2.xml');
    assert.match(first, /<a:rPr b="1"\s*\/><a:t>Исправленный &lt;текст&gt;<\/a:t>/);
    assert.match(first, /<a:off x="1200" y="2400"/);
    assert.match(first, /<a:fld><a:t>Поле<\/a:t><\/a:fld>/);
    assert.match(second, /<a:rPr i="1"\s*\/><a:t> экран<\/a:t>/);
    assert.equal(await read('ppt/media/sample.bin'), slides['ppt/media/sample.bin']);
    assert.deepEqual(errors,[]);
    console.log('PASS: PPTX navigation, draft recovery, text round-trip, XML escaping, run styles, geometry and media');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
