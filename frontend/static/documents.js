import {ask, el, icon, pickFile, download, bytes, emit} from './core.js';
import {fs} from './storage.js';
import {OfficePackage, child, children, descendants, attribute} from './office-package.js';
import {createWordEditor} from './word-editor.js';
import {createOfficeDataEditor} from './office-data-editor.js';
import {DOCX_MIME} from './word-format.js';

const TYPES = {
  pdf: ['PDF', 'application/pdf'],
  docx: ['Word · DOCX', DOCX_MIME],
  pptx: ['PowerPoint · PPTX', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  xlsx: ['Excel · XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};
const imageTypes = {png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp'};
const MAX_FILE = 32 * 1024 * 1024;
const ext = name => /\.([^.\/\\]+)$/.exec(String(name).toLowerCase())?.[1];
const textOf = (node, name = 't') => descendants(node, name).map(part => part.textContent).join('');
const validColor = value => /^[\da-f]{6}$/i.test(value ?? '') ? '#' + value : '';
export const documentFormat = node => Object.hasOwn(TYPES, ext(node.name)) ? ext(node.name)
  : Object.keys(TYPES).find(type => TYPES[type][1] === node.mime);

function imageFor(node, packageFile, relations, urls) {
  const ref = attribute(descendants(node, 'blip')[0], 'embed');
  const part = relations.get(ref);
  const mime = part && imageTypes[ext(part.path)];
  if (!mime) return null;
  const image = el('img', {alt: (attribute(descendants(node, 'docPr')[0], 'descr') ?? '').slice(0,160)});
  image.previewReady = packageFile.read(part.path).then(data => {
    if (!data || urls.closed) { image.hidden = true; return; }
    image.src = urls.image(part.path, data, mime);
    return image.decode();
  }).catch(() => { image.hidden = true; });
  return image;
}

function numberingInfo(root) {
  const abstracts = new Map(children(root,'abstractNum').map(item => [attribute(item,'abstractNumId'),item]));
  return new Map(children(root,'num').map(item => {
    const definition = abstracts.get(attribute(child(item,'abstractNumId'),'val'));
    const level = child(definition,'lvl');
    const format = attribute(child(level,'numFmt'),'val');
    const start = Number(attribute(child(child(item,'lvlOverride'),'startOverride'),'val')
      ?? attribute(child(level,'start'),'val')) || 1;
    return [attribute(item,'numId'), {ordered:Boolean(format && format !== 'bullet' && format !== 'none'), start}];
  }));
}

function renderWord(packageFile, root, relations, urls, numbers) {
  const body = child(root, 'body');
  if (!body) throw new Error('В документе Word отсутствует основная часть.');
  let remaining = 3000;
  let runs = 16000;
  let textBudget = 400000;
  let truncated = false;
  function blocks(node, holder, depth = 0) {
    if (depth > 8) { truncated = true; return; }
    let list, previousId;
    for (const block of children(node)) {
      if (--remaining < 0) break;
      if (block.localName === 'p') {
        const props = child(block, 'pPr');
        const style = attribute(child(props, 'pStyle'), 'val') ?? '';
        const heading = /^heading([1-4])$/i.exec(style);
        const numId = attribute(child(child(props,'numPr'),'numId'),'val');
        const numbered = numId && numId !== '0';
        const paragraph = el(numbered ? 'li' : heading ? 'h' + heading[1] : /^title$/i.test(style) ? 'h1' : 'p');
        if (numbered && previousId !== numId) {
          const numbering = numbers.get(numId);
          list = el(numbering?.ordered ? 'ol' : 'ul', {start:numbering?.ordered ? numbering.start : undefined});
          holder.append(list);
        }
        previousId = numbered ? numId : undefined;
        const alignment = attribute(child(props, 'jc'), 'val');
        if (['center', 'right', 'left', 'both'].includes(alignment)) paragraph.style.textAlign = alignment === 'both' ? 'justify' : alignment;
        for (const run of descendants(block, 'r')) {
          if (run.namespaceURI !== block.namespaceURI) continue;
          if (runs-- <= 0 || !textBudget) { truncated = true; break; }
          const format = child(run, 'rPr');
          const span = el('span');
          for (const [key, property, value] of [['b','fontWeight','bold'],['i','fontStyle','italic']]) {
            const flag = child(format, key);
            if (flag) span.style[property] = ['0','false','none','off'].includes(attribute(flag,'val')) ? 'normal' : value;
          }
          const decoration = [['u','underline'],['strike','line-through']].filter(([key]) => {
            const flag = child(format,key);
            return flag && !['0','false','none','off'].includes(attribute(flag,'val'));
          }).map(([,value]) => value).join(' ');
          if (decoration) span.style.textDecorationLine = decoration;
          const family = child(format,'rFonts');
          const font = attribute(family,'hAnsi') || attribute(family,'ascii');
          if (font) span.style.fontFamily = JSON.stringify(font.slice(0,64));
          const size = Number(attribute(child(format,'sz'),'val')) / 2;
          if (size >= 6 && size <= 160) span.style.fontSize = size + 'pt';
          span.style.color = validColor(attribute(child(format, 'color'), 'val'));
          span.style.backgroundColor = validColor(attribute(child(format,'shd'),'fill'));
          for (const item of children(run)) {
            if (item.localName === 't') {
              const value = item.textContent.slice(0, textBudget);
              textBudget -= value.length;
              if (value.length < item.textContent.length) truncated = true;
              span.append(value);
            }
            if (item.localName === 'tab') span.append('\t');
            if (item.localName === 'br') span.append(el('br'));
            if (item.localName === 'drawing') {
              const image = imageFor(item, packageFile, relations, urls);
              if (image) span.append(image);
              else truncated = true;
            }
            if (item.localName === 'pict' || item.localName === 'object') truncated = true;
          }
          paragraph.append(span);
        }
        if (!paragraph.textContent && !paragraph.querySelector('img,br')) paragraph.append(el('br'));
        (numbered ? list : holder).append(paragraph);
      } else if (block.localName === 'tbl') {
        previousId = undefined;
        const table = el('table');
        const rows = children(block,'tr');
        if (rows.length > 150) truncated = true;
        for (const row of rows.slice(0,150)) {
          const tr = el('tr');
          const cells = children(row,'tc');
          if (cells.length > 30) truncated = true;
          for (const cell of cells.slice(0,30)) {
            const td = el('td');
            const span = Number(attribute(child(child(cell, 'tcPr'), 'gridSpan'), 'val'));
            if (span >= 2 && span <= 30) td.colSpan = span;
            blocks(cell, td, depth + 1);
            tr.append(td);
          }
          table.append(tr);
          if (remaining < 0) break;
        }
        holder.append(table);
      } else if (block.localName === 'sdt') {
        previousId = undefined;
        blocks(child(block, 'sdtContent'), holder, depth + 1);
      }
    }
  }
  const paper = el('article', {class:'office-paper office-word'});
  blocks(body, paper);
  if (remaining < 0 || truncated) paper.append(el('p', {class:'office-limit'}, 'Показана часть большого документа.'));
  return paper;
}

function navigation(list, label, open, signal) {
  const previous = el('button', {type:'button', 'aria-label':'Предыдущий', title:'Предыдущий'});
  const next = el('button', {type:'button', 'aria-label':'Следующий', title:'Следующий'});
  previous.innerHTML = icon('back'); next.innerHTML = icon('arrow');
  const select = el('select', {'aria-label':label}, ...list.map((item, index) => el('option', {value:index}, item.name)));
  const view = el('div', {class:'office-page-view'});
  let revision = 0;
  async function render(index) {
    const current = ++revision;
    select.value = index;
    previous.disabled = index === 0;
    next.disabled = index === list.length - 1;
    view.replaceChildren(el('p', {class:'office-message'}, 'Загрузка…'));
    try {
      const content = await open(list[index]);
      if (!signal.aborted && current === revision) view.replaceChildren(content);
    } catch (error) {
      if (!signal.aborted && current === revision) view.replaceChildren(el('p', {class:'office-message'}, error.message));
    }
  }
  select.onchange = () => render(Number(select.value));
  previous.onclick = () => render(Number(select.value) - 1);
  next.onclick = () => render(Number(select.value) + 1);
  render(0);
  return el('div', {class:'office-paged'}, el('div', {class:'office-pagination'}, previous, select, next), view);
}

function slideObject(shape, presentationSize, packageFile, relations, urls) {
  const [width, height] = presentationSize;
  const paragraphs = children(child(shape, 'txBody'), 'p');
  const image = shape.localName === 'pic' ? imageFor(shape, packageFile, relations, urls) : null;
  const table = descendants(shape, 'tbl')[0];
  if (!image && !paragraphs.length && !table) return null;
  const box = el('div', {class:'office-slide-object'});
  const transform = child(child(shape, 'spPr'), 'xfrm') ?? child(shape, 'xfrm');
  const off = child(transform, 'off'), size = child(transform, 'ext');
  const coords = [off?.getAttribute('x'), off?.getAttribute('y'), size?.getAttribute('cx'), size?.getAttribute('cy')];
  if (coords.every(value => value != null && Number.isFinite(Number(value)))) {
    box.classList.add('positioned');
    for (const [index, name] of ['left','top','width','height'].entries()) {
      const percent = Math.max(index > 1 ? 0 : -200, Math.min(200, 100 * Number(coords[index]) / (index % 2 ? height : width)));
      box.style[name] = `${percent}%`;
    }
  }
  if (image) box.append(image);
  for (const para of paragraphs) {
    const p = el('p');
    const props = child(para, 'pPr');
    if (attribute(props, 'algn') === 'ctr') p.style.textAlign = 'center';
    if (child(props, 'buChar')) p.append('• ');
    for (const run of children(para)) {
      if (run.localName === 'br') { p.append(el('br')); continue; }
      const text = child(run, 't')?.textContent;
      if (text == null) continue;
      const style = child(run, 'rPr');
      const span = el('span', {}, text);
      const pt = Number(attribute(style, 'sz')) / 100;
      if (pt > 0 && pt <= 160) span.style.fontSize = `${pt * 12700 * 100 / width}cqw`;
      if (attribute(style, 'b') === '1') span.style.fontWeight = 'bold';
      if (attribute(style, 'i') === '1') span.style.fontStyle = 'italic';
      span.style.color = validColor(attribute(child(child(style, 'solidFill'), 'srgbClr'), 'val'));
      p.append(span);
    }
    box.append(p);
  }
  if (table) {
    box.append(el('table', {}, ...children(table, 'tr').slice(0, 50).map(row =>
      el('tr', {}, ...children(row, 'tc').slice(0, 30).map(cell => el('td', {}, textOf(cell)))))));
  }
  return box;
}

async function renderSlides(packageFile, root, links, urls, signal) {
  const ids = children(child(root, 'sldIdLst'), 'sldId');
  const slides = ids.map((id, index) => {
    const ref = [...id.attributes].find(attr => attr.localName === 'id' && attr.namespaceURI)?.value;
    return {name:`Слайд ${index + 1}`, path:links.get(ref)?.path};
  }).filter(item => item.path);
  if (!slides.length) throw new Error('В презентации не найдено слайдов.');
  const size = child(root, 'sldSz');
  const width = Number(size?.getAttribute('cx')) || 9144000;
  const height = Number(size?.getAttribute('cy')) || 5143500;
  return navigation(slides, 'Выбор слайда', async ({path}) => {
    const [slide, relations] = await Promise.all([packageFile.xml(path), packageFile.relationships(path)]);
    const content = child(slide, 'cSld');
    if (!content) throw new Error('Слайд не найден.');
    const paper = el('article', {class:'office-paper office-slide'});
    paper.style.aspectRatio = `${width} / ${height}`;
    paper.style.backgroundColor = validColor(attribute(descendants(child(content,'bg'), 'srgbClr')[0], 'val'));
    for (const shape of children(child(content,'spTree')).slice(0, 300)) {
      const object = slideObject(shape, [width,height], packageFile, relations, urls);
      if (object) paper.append(object);
    }
    if (!paper.children.length) paper.append(el('p', {class:'office-limit'}, 'На этом слайде нет доступного для предпросмотра содержимого.'));
    return paper;
  }, signal);
}

function columnIndex(reference) {
  const code = /^[A-Z]+/.exec(reference ?? '')?.[0];
  return code ? [...code].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1 : -1;
}
const columnName = number => number < 26 ? String.fromCharCode(65 + number) : 'A' + String.fromCharCode(65 + number - 26);

async function renderWorkbook(packageFile, root, links, signal) {
  const sheets = children(child(root, 'sheets'), 'sheet').map((sheet, index) => ({
    name: sheet.getAttribute('name')?.slice(0,128) || `Лист ${index + 1}`, path:links.get(attribute(sheet,'id'))?.path,
  })).filter(item => item.path);
  if (!sheets.length) throw new Error('В книге не найдено листов.');
  const stringsPath = [...links.values()].find(part => part.type.endsWith('/sharedStrings'))?.path ?? 'xl/sharedStrings.xml';
  const shared = children(await packageFile.xml(stringsPath), 'si').map(string => textOf(string));
  return navigation(sheets, 'Выбор листа', async ({path}) => {
    const sheet = await packageFile.xml(path);
    if (!sheet) throw new Error('Лист не найден.');
    const rows = children(child(sheet,'sheetData'), 'row');
    let count = 1, truncated = rows.length > 250;
    const preview = rows.slice(0, 250).map((row, index) => {
      const values = new Map();
      children(row,'c').forEach((cell, fallback) => {
        const column = columnIndex(cell.getAttribute('r'));
        const position = column < 0 ? fallback : column;
        if (position >= 40) { truncated = true; return; }
        count = Math.max(count, position + 1);
        const raw = child(cell,'v')?.textContent ?? '';
        const type = cell.getAttribute('t');
        let value = raw;
        if (type === 's') value = /^\d+$/.test(raw) ? shared[Number(raw)] ?? '' : '';
        else if (type === 'inlineStr') value = textOf(cell);
        else if (type === 'b') value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '';
        const formula = child(cell,'f')?.textContent ?? '';
        if (value.length > 2000 || formula.length > 2000) truncated = true;
        values.set(position, {value:value.slice(0,2000), formula:formula.slice(0,2000)});
      });
      return {number:row.getAttribute('r') || String(index + 1), values};
    });
    const paper = el('div', {class:'office-sheet'});
    const head = el('tr', {}, el('th'), ...Array.from({length:count}, (_, index) => el('th', {}, columnName(index))));
    const table = el('table', {}, el('thead', {}, head), el('tbody', {}, ...preview.map(({number,values}) =>
      el('tr', {}, el('th', {scope:'row'}, number), ...Array.from({length:count}, (_, index) => {
        const cell = values.get(index);
        return el('td', {title:cell?.formula ? '=' + cell.formula : undefined}, cell?.value || '');
      })))));
    paper.append(table);
    if (truncated) paper.append(el('p', {class:'office-limit'}, 'Предпросмотр ограничен 250 строками, 40 столбцами и 2000 знаками в ячейке.'));
    return paper;
  }, signal);
}

async function preview(node, format, urls, signal) {
  if (format === 'pdf') {
    if (new TextDecoder().decode(node.data.subarray(0,5)) !== '%PDF-') throw new Error('Файл не содержит заголовка PDF.');
    if (!navigator.pdfViewerEnabled) throw new Error('Встроенный просмотр PDF в этом браузере недоступен. Скачайте исходный файл.');
    return el('iframe', {class:'office-pdf', title:node.name, src:urls.create(new Blob([node.data], {type:'application/pdf'}))});
  }
  const fallback = {docx:'word/document.xml', pptx:'ppt/presentation.xml', xlsx:'xl/workbook.xml'};
  const packageFile = new OfficePackage(node.data);
  const path = await packageFile.rootPart(fallback[format]);
  const [root, links] = await Promise.all([packageFile.xml(path), packageFile.relationships(path)]);
  if (!root) throw new Error('Основная часть документа Office не найдена.');
  if (format === 'docx') {
    const path = [...links.values()].find(part => part.type.endsWith('/numbering'))?.path ?? 'word/numbering.xml';
    return renderWord(packageFile, root, links, urls, numberingInfo(await packageFile.xml(path)));
  }
  if (format === 'pptx') return renderSlides(packageFile, root, links, urls, signal);
  return renderWorkbook(packageFile, root, links, signal);
}

function objectUrls() {
  const urls = new Map();
  const images = new Map();
  return {closed:false, create(blob) {
    if (this.closed) return '';
    const url = URL.createObjectURL(blob);
    urls.set(url,blob);
    return url;
  }, get(url) {
    return urls.get(url);
  }, image(path, data, mime) {
    if (!images.has(path)) images.set(path, this.create(new Blob([data], {type:mime})));
    return images.get(path);
  }, dispose() {
    this.closed = true;
    for (const url of urls.keys()) URL.revokeObjectURL(url);
    urls.clear();
    images.clear();
  }};
}

export const documentsApp = {
  id:'office', name:'Документы', subtitle:'Редактор Word, презентации, таблицы и PDF', keywords:'docx pptx xlsx pdf офис',
  icon:'editor', width:940, height:720,
  mount(win, {id}) {
    const open = el('button', {type:'button'}, 'Открыть файл…');
    const newWord = el('button', {type:'button'}, 'Новый документ Word');
    const edit = el('button', {type:'button', class:'primary', hidden:true}, 'Редактировать копию');
    const save = el('button', {type:'button', hidden:true}, 'Сохранить в Документы');
    const exportFile = el('button', {type:'button', hidden:true}, 'Скачать оригинал');
    const original = el('button', {type:'button', hidden:true}, 'К оригиналу');
    const info = el('span', {class:'office-file-info'});
    const holder = el('main', {class:'office-view', 'aria-label':'Содержимое документа'});
    win.body.append(el('header', {class:'toolbar office-toolbar'}, open, newWord, edit, save, exportFile, original, info), holder);
    let source, sourceLocal = false, sourcePreview, session, busy = false;
    let urls = objectUrls(), renderAbort = new AbortController();

    const mime = node => TYPES[documentFormat(node)]?.[1] || node.mime || 'application/octet-stream';
    const copyName = (name, format) => name.replace(/\.[^.]+$/, '').slice(0,148) + ' — копия.' + format;

    function dirty() {
      return session?.kind === 'docx' ? session.editor.isDirty()
        : Boolean(session && session.revision !== session.savedRevision);
    }
    win.hasUnsavedChanges = dirty;

    function updateControls() {
      const format = source && documentFormat(source);
      edit.hidden = Boolean(session || !sourcePreview || !format || format === 'pdf');
      save.hidden = !session && !sourceLocal;
      save.textContent = session?.kind === 'docx' ? 'Сохранить DOCX' : session ? 'Сохранить копию' : 'Сохранить в Документы';
      save.classList.toggle('primary',Boolean(session));
      exportFile.hidden = !session && !source;
      exportFile.textContent = session ? 'Скачать ' + session.kind.toUpperCase() : 'Скачать оригинал';
      original.hidden = !session || !source;
      for (const control of [open,newWord,edit,save,exportFile,original]) control.disabled = busy;
      if (session) {
        const kind = session.kind.toUpperCase();
        const changed = dirty();
        info.textContent = `${kind} · ${changed ? 'Изменения не сохранены' : session.savedNode ? 'Сохранено' : 'Редактирование'}`;
        const name = session.kind === 'docx' ? session.editor.filename() : session.name;
        const title = changed ? '● ' + name : name;
        if (win.title !== title) win.setTitle(title);
      }
      win.save = session ? () => save.click() : undefined;
    }

    function run(action) {
      return async () => {
        if (busy || win.abort.signal.aborted) return;
        busy = true;
        updateControls();
        try { await action(); }
        catch (error) {
          if (!win.abort.signal.aborted) emit('toast', {message:error.message,error:true});
        } finally {
          busy = false;
          if (!win.abort.signal.aborted) updateControls();
        }
      };
    }

    async function allowDiscard() {
      return !dirty() || Boolean(await ask('Закрыть редактирование?', {
        message:'Изменения в этой копии ещё не сохранены.',confirm:true,ok:'Закрыть без сохранения',
      }));
    }
    win.beforeClose = () => !busy && allowDiscard();

    function reset(keepUrls = false) {
      session?.editor.dispose?.();
      session = null;
      renderAbort.abort();
      renderAbort = new AbortController();
      if (!keepUrls) {
        urls.dispose();
        urls = objectUrls();
      }
    }

    async function show(node, local = false) {
      const format = documentFormat(node);
      reset();
      source = node;
      sourceLocal = local;
      sourcePreview = null;
      const {signal} = renderAbort;
      win.setTitle(node.name);
      info.textContent = format ? `${TYPES[format][0]} · ${bytes(node.data.byteLength)}` : bytes(node.data.byteLength);
      updateControls();
      holder.replaceChildren(el('p', {class:'office-message'}, 'Открываем документ…'));
      try {
        if (!format) throw new Error('Поддерживаются PDF, DOCX, PPTX и XLSX.');
        if (node.data.byteLength > MAX_FILE) throw new Error('Лимит предпросмотра — 32 МБ.');
        const view = await preview(node, format, urls, signal);
        if (!signal.aborted) {
          sourcePreview = view;
          holder.replaceChildren(view);
          updateControls();
        }
      } catch (error) {
        if (!signal.aborted) holder.replaceChildren(el('p', {class:'office-message'}, error.message));
      }
    }

    function beginWord(content) {
      reset(Boolean(content));
      const name = content ? copyName(source.name,'docx') : 'Без названия.docx';
      const {signal} = renderAbort;
      const resources = urls;
      const editor = createWordEditor({name,content,imageSource:url => resources.get(url),
        registerImage:blob => resources.create(blob),onChange:updateControls,signal});
      session = {kind:'docx',editor};
      win.setTitle(name);
      holder.replaceChildren(editor.element);
      editor.focus();
    }

    async function beginEdit() {
      const kind = documentFormat(source);
      if (kind === 'docx') {
        const images = [...sourcePreview.querySelectorAll('img')];
        await Promise.all(images.map(image => image.previewReady));
        if (win.abort.signal.aborted) return;
        const missing = images.filter(image => image.hidden);
        if (sourcePreview.querySelector('.office-limit') || missing.length) {
          const accepted = await ask('Редактировать доступную часть?', {
            message:'Часть содержимого недоступна. В редактируемую копию попадут показанный текст и загруженные изображения.',
            confirm:true,ok:'Открыть копию',
          });
          if (!accepted) return;
        }
        missing.forEach(image => image.remove());
        beginWord(sourcePreview);
        return;
      }
      const draft = {kind,name:copyName(source.name,kind),revision:0,savedRevision:0};
      draft.editor = await createOfficeDataEditor(source,kind,{signal:renderAbort.signal,onChange:() => {
        draft.revision++;
        if (session === draft) updateControls();
      }});
      if (win.abort.signal.aborted) return;
      session = draft;
      win.setTitle(draft.name);
      holder.replaceChildren(draft.editor.element);
    }

    function freeName(name) {
      const names = new Set(fs.list('documents').map(node => node.name));
      if (!names.has(name)) return name;
      const dot = name.lastIndexOf('.');
      for (let count = 2; ; count++) {
        const suffix = ` (${count})` + name.slice(dot);
        const next = name.slice(0,Math.min(dot,180 - suffix.length)) + suffix;
        if (!names.has(next)) return next;
      }
    }

    async function build() {
      if (session.kind === 'docx') return session.editor.build();
      const building = session.editor.build();
      const stamp = session.revision;
      return {data:await building,name:session.name,stamp};
    }

    open.onclick = run(async () => {
      const [file] = await pickFile('.pdf,.docx,.pptx,.xlsx');
      if (!file || win.abort.signal.aborted || !await allowDiscard()) return;
      if (file.size > MAX_FILE) throw new Error('Лимит одного документа — 32 МБ.');
      const data = new Uint8Array(await file.arrayBuffer());
      if (!win.abort.signal.aborted) await show({name:file.name,mime:file.type,data},true);
    });
    newWord.onclick = run(async () => {
      if (!await allowDiscard()) return;
      source = sourcePreview = null;
      sourceLocal = false;
      beginWord();
    });
    edit.onclick = run(beginEdit);
    original.onclick = run(async () => { if (await allowDiscard()) await show(source,sourceLocal); });
    save.onclick = run(async () => {
      if (!session) {
        const node = await fs.write('documents',source.name,source.data,mime(source));
        source = node;
        sourceLocal = false;
      } else {
        const result = await build();
        if (win.abort.signal.aborted) return;
        const previous = session.savedNode;
        if (previous && (fs.get(previous.id) !== previous || fs.isTrashed(previous))) {
          throw new Error('Сохранённая копия уже изменена или перемещена. Скачайте результат отдельно.');
        }
        const name = previous ? result.name : freeName(result.name);
        const node = await fs.write('documents',name,result.data,TYPES[session.kind][1],previous?.id);
        session.savedNode = node;
        if (session.kind === 'docx') session.editor.markSaved(result,node.name);
        else {
          session.name = node.name;
          session.savedRevision = result.stamp;
        }
        win.setTitle(node.name);
      }
      emit('toast', {message:'Документ сохранён в папку «Документы».'});
    });
    exportFile.onclick = run(async () => {
      if (!session) { download(source.name,source.data,mime(source)); return; }
      const result = await build();
      if (!win.abort.signal.aborted) download(result.name,result.data,TYPES[session.kind][1]);
    });
    const node = id && fs.get(id);
    if (node?.type === 'file') show(node);
    else holder.append(el('div', {class:'office-empty'}, el('h2', {}, 'Просмотр документов'),
      el('p', {}, 'Создай документ Word или открой PDF, DOCX, PPTX и XLSX с устройства.'),
      el('div', {class:'office-empty-actions'},
        el('button', {type:'button', class:'primary', onclick:() => newWord.click()}, 'Создать DOCX'),
        el('button', {type:'button', onclick:() => open.click()}, 'Выбрать документ'))));
    return () => { session?.editor.dispose?.(); renderAbort.abort(); urls.dispose(); };
  },
};
