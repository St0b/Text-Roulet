import {writeOfficeZip} from './office-package.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PROLOG = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const XML = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\uD800-\uDFFF\uFFFE\uFFFF]/gu, '')
  .replace(/[&<>"']/g, token => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[token]));
const blockTags = new Set(['P','DIV','H1','H2','H3','H4','UL','OL','TABLE','BLOCKQUOTE']);
const baseStyle = {font:'Calibri', size:11, color:'243139', fill:'', bold:false, italic:false, underline:false, strike:false};
const headingSizes = {H1:26,H2:20,H3:16,H4:13};

function hexColor(value) {
  if (/^#[\da-f]{6}$/i.test(value)) return value.slice(1).toUpperCase();
  const match = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:[, /]+\s*(1|1\.0+))?\s*\)$/i.exec(value);
  return match ? match.slice(1,4).map(n => Math.min(255, Number(n)).toString(16).padStart(2,'0')).join('').toUpperCase() : '';
}

export function fontFamily(value) {
  return String(value ?? '').split(',')[0].trim().replace(/^['"]|['"]$/g,'').slice(0, 64);
}

function styled(node, parent) {
  const props = {...parent};
  const {style, tagName: tag} = node;
  if (headingSizes[tag]) { props.size = headingSizes[tag]; props.bold = true; }
  if (tag === 'B' || tag === 'STRONG') props.bold = true;
  if (tag === 'I' || tag === 'EM') props.italic = true;
  if (tag === 'U') props.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') props.strike = true;
  const font = fontFamily(style.fontFamily || node.getAttribute('face'));
  if (font) props.font = font;
  const size = parseFloat(style.fontSize);
  if (Number.isFinite(size)) {
    props.size = style.fontSize.endsWith('px') ? size * .75 : style.fontSize.endsWith('pt') ? size : props.size;
  }
  const color = hexColor(style.color || node.getAttribute('color') || '');
  if (color) props.color = color;
  const fill = hexColor(style.backgroundColor);
  if (fill) props.fill = fill;
  if (style.fontWeight) props.bold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
  if (style.fontStyle) props.italic = ['italic','oblique'].includes(style.fontStyle);
  const decoration = style.textDecorationLine || style.textDecoration;
  if (decoration) {
    props.underline = decoration.includes('underline');
    props.strike = decoration.includes('line-through');
  }
  return props;
}

function runProperties(style) {
  const font = XML(style.font);
  const size = Math.round(Math.max(6, Math.min(160, style.size)) * 2);
  const mark = (name, enabled) => enabled ? `<w:${name}/>` : `<w:${name} w:val="0"/>`;
  return `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>`
    + mark('b',style.bold) + mark('i',style.italic) + mark('strike',style.strike)
    + `<w:color w:val="${style.color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`
    + `<w:u w:val="${style.underline ? 'single' : 'none'}"/>`
    + (style.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${style.fill}"/>` : '') + '</w:rPr>';
}

function textRun(text, style) {
  if (!text) return '';
  const parts = text.split(/([\t\n])/).map(part => {
    if (!part) return '';
    if (part === '\t') return '<w:tab/>';
    if (part === '\n') return '<w:br/>';
    return `<w:t xml:space="preserve">${XML(part)}</w:t>`;
  });
  return `<w:r>${runProperties(style)}${parts.join('')}</w:r>`;
}

function drawing(id, relation, width, height, description) {
  const scale = Math.min(1, 576 / width);
  const cx = Math.round(width * scale * 9525);
  const cy = Math.round(height * scale * 9525);
  const title = XML(description || `Изображение ${id}`);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${id}" name="${title}" descr="${title}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${title}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relation}"/>`
    + `<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

function stylesXml() {
  const headings = Object.entries(headingSizes).map(([tag,size], index) => `<w:style w:type="paragraph" w:styleId="Heading${tag[1]}">`
    + `<w:name w:val="heading ${tag[1]}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`
    + `<w:pPr><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="${index}"/></w:pPr>`
    + `<w:rPr><w:b/><w:sz w:val="${size * 2}"/></w:rPr></w:style>`).join('');
  return `${PROLOG}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault>${runProperties(baseStyle)}</w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:after="110" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' + headings + '</w:styles>';
}

function numberingXml(lists) {
  const abstract = (id, format, text) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/>`
    + `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>`
    + '<w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="270"/></w:pPr></w:lvl></w:abstractNum>';
  const instances = lists.map(({id,ordered,start}) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${ordered ? 1 : 0}"/>`
    + (start !== 1 ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride>` : '') + '</w:num>').join('');
  return `${PROLOG}<w:numbering xmlns:w="${W}">${abstract(0,'bullet','•')}${abstract(1,'decimal','%1.')}${instances}</w:numbering>`;
}

function tableMarkup(rows, columnCount) {
  const borders = ['top','left','bottom','right','insideH','insideV']
    .map(edge => `<w:${edge} w:val="single" w:sz="5" w:color="9CAEB9"/>`).join('');
  const grid = '<w:gridCol w:w="' + Math.floor(9000 / columnCount) + '"/>';
  return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + borders
    + '</w:tblBorders></w:tblPr><w:tblGrid>' + grid.repeat(columnCount) + '</w:tblGrid>' + rows.join('') + '</w:tbl>';
}

export async function buildDocx(editor, imageSource) {
  const parts = new Map();
  const lists = [];
  const media = new Map();
  let drawings = 0;
  let mediaSize = 0;
  const relationships = [
    `<Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/>`,
    `<Relationship Id="numbering" Type="${R}/numbering" Target="numbering.xml"/>`,
  ];

  async function imageRun(image) {
    const url = image.getAttribute('src');
    const blob = imageSource(url);
    const width = Number(image.dataset.width) || image.naturalWidth;
    const height = Number(image.dataset.height) || image.naturalHeight;
    if (!blob || !width || !height) throw new Error('Дождитесь загрузки изображения или удалите его из документа.');
    if (!media.has(url)) {
      const extension = {'image/png':'png','image/jpeg':'jpeg','image/gif':'gif','image/bmp':'bmp','image/webp':'webp'}[blob.type];
      if (!extension) throw new Error('Этот формат изображения нельзя сохранить в DOCX.');
      mediaSize += blob.size;
      if (mediaSize > 25 * 1024 * 1024) throw new Error('Изображения в документе занимают больше 25 МБ.');
      const number = media.size + 1;
      const target = `media/image${number}.${extension}`;
      const id = `image${number}`;
      parts.set(`word/${target}`, new Uint8Array(await blob.arrayBuffer()));
      relationships.push(`<Relationship Id="${id}" Type="${R}/image" Target="${target}"/>`);
      media.set(url, {id, extension, mime:blob.type});
    }
    return drawing(++drawings, media.get(url).id, width, height, image.alt);
  }

  async function runs(nodes, parent, depth = 0) {
    if (depth > 80) throw new Error('Слишком сложное форматирование текста.');
    let xml = '';
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) xml += textRun(node.data, parent);
      else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'IMG') xml += await imageRun(node);
        else if (node.tagName === 'BR') xml += '<w:r><w:br/></w:r>';
        else xml += await runs(node.childNodes, styled(node,parent), depth + 1);
      }
    }
    return xml;
  }

  async function paragraph(element, nodes, list) {
    const style = element ? styled(element, baseStyle) : baseStyle;
    const alignment = element?.style.textAlign || element?.getAttribute('align');
    const align = {left:'left',right:'right',center:'center',justify:'both'}[alignment];
    const heading = element?.tagName.match(/^H([1-4])$/)?.[1];
    const properties = (heading ? `<w:pStyle w:val="Heading${heading}"/>` : '')
      + (list ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${list.id}"/></w:numPr>` : '')
      + (align ? `<w:jc w:val="${align}"/>` : '');
    const content = [...nodes];
    if (content.at(-1)?.nodeName === 'BR') content.pop();
    return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${await runs(content, style)}</w:p>`;
  }

  async function blocks(container, depth = 0) {
    if (depth > 14) throw new Error('Слишком глубокая вложенность таблиц или списков.');
    let xml = '';
    let inline = [];
    for (const node of Array.isArray(container) ? container : container.childNodes) {
      if (!blockTags.has(node.nodeName)) { inline.push(node); continue; }
      if (inline.some(item => item.nodeType === Node.ELEMENT_NODE || item.textContent.trim())) xml += await paragraph(null, inline);
      inline = [];
      if (node.tagName === 'TABLE') {
        const rows = [];
        let columns = 1;
        for (const row of node.rows) {
          let cells = '';
          let count = 0;
          for (const cell of row.cells) {
            const span = Math.min(30, cell.colSpan);
            count += span;
            const properties = span > 1 ? `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>` : '';
            const content = await blocks(cell,depth + 1);
            const trailingParagraph = !content || content.endsWith('</w:tbl>') ? '<w:p/>' : '';
            cells += `<w:tc>${properties}${content}${trailingParagraph}</w:tc>`;
          }
          columns = Math.max(columns, count);
          if (cells) rows.push(`<w:tr>${cells}</w:tr>`);
        }
        if (rows.length) xml += tableMarkup(rows, columns);
      } else if (node.tagName === 'UL' || node.tagName === 'OL') {
        const list = {id:lists.length + 1, ordered:node.tagName === 'OL', start:Math.max(1, Math.min(999999, node.start || 1))};
        lists.push(list);
        for (const item of [...node.children].filter(element => element.tagName === 'LI')) {
          xml += await paragraph(item, [...item.childNodes].filter(element => !['UL','OL'].includes(element.nodeName)), list);
          const nested = [...item.children].filter(element => ['UL','OL'].includes(element.tagName));
          if (nested.length) xml += await blocks(nested, depth + 1);
        }
      } else if ([...node.children].some(element => blockTags.has(element.tagName))) xml += await blocks(node, depth + 1);
      else xml += await paragraph(node, node.childNodes);
    }
    if (inline.some(item => item.nodeType === Node.ELEMENT_NODE || item.textContent.trim())) xml += await paragraph(null, inline);
    return xml;
  }

  const body = await blocks(editor);
  if (body.length > 12 * 1024 * 1024) throw new Error('Документ слишком велик для сохранения.');
  const page = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1260" w:right="1260" w:bottom="1260" w:left="1260" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  parts.set('word/document.xml', `${PROLOG}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body || '<w:p/>'}${page}</w:body></w:document>`);
  parts.set('word/styles.xml', stylesXml());
  parts.set('word/numbering.xml', numberingXml(lists));
  parts.set('_rels/.rels', `${PROLOG}<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  parts.set('word/_rels/document.xml.rels', `${PROLOG}<Relationships xmlns="${REL}">${relationships.join('')}</Relationships>`);
  const extensions = new Map([...media.values()].map(item => [item.extension,item.mime]));
  const imageTypes = [...extensions].map(([extension,mime]) => `<Default Extension="${extension}" ContentType="${mime}"/>`).join('');
  const documentTypes = [['document',DOCX_MIME + '.main+xml'], ['styles','application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ['numbering','application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml']]
    .map(([name,mime]) => `<Override PartName="/word/${name}.xml" ContentType="${mime}"/>`).join('');
  parts.set('[Content_Types].xml', `${PROLOG}<Types xmlns="${TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes}${documentTypes}</Types>`);
  return writeOfficeZip(parts);
}
