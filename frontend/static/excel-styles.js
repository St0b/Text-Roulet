import {child,children} from './office-package.js';

export const EXCEL_FONTS=['Aptos','Arial','Calibri','Cambria','Consolas','Georgia','Times New Roman','Verdana'];
const STYLES_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml';
const REL_NS='http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES_NS='http://schemas.openxmlformats.org/package/2006/content-types';
const REL_BASE='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAX_STYLES=64000;
const defaultStyle={family:'Calibri',size:11,bold:false};
const columnCache=new WeakMap();
const styleOrder=['numFmts','fonts','fills','borders','cellStyleXfs','cellXfs','cellStyles','dxfs','tableStyles','colors','extLst'];

function xmlChild(parent,tag,attributes={}) {
  const name=parent.prefix ? parent.prefix+':'+tag : tag;
  const node=parent.ownerDocument.createElementNS(parent.namespaceURI,name);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
  return node;
}

function add(parent,tag,attributes) {
  const element=xmlChild(parent,tag,attributes);
  parent.append(element);
  return element;
}

function defaultStyles(namespace) {
  const root=document.implementation.createDocument(namespace,'styleSheet').documentElement;
  const font=add(add(root,'fonts',{count:1}),'font');
  add(font,'sz',{val:defaultStyle.size});
  add(font,'name',{val:defaultStyle.family});
  const fills=add(root,'fills',{count:2});
  for (const patternType of ['none','gray125']) add(add(fills,'fill'),'patternFill',{patternType});
  add(add(root,'borders',{count:1}),'border');
  const xf={numFmtId:0,fontId:0,fillId:0,borderId:0};
  add(add(root,'cellStyleXfs',{count:1}),'xf',xf);
  add(add(root,'cellXfs',{count:1}),'xf',{...xf,xfId:0});
  add(add(root,'cellStyles',{count:1}),'cellStyle',{name:'Normal',xfId:0,builtinId:0});
  return root;
}

function completeStyles(root,defaults) {
  for (const fallback of children(defaults)) {
    const existing=child(root,fallback.localName);
    if (!existing) {
      const index=styleOrder.indexOf(fallback.localName);
      const next=children(root).find(node=>styleOrder.indexOf(node.localName)>index);
      root.insertBefore(root.ownerDocument.importNode(fallback,true),next??null);
    } else if (!existing.children.length) {
      existing.append(...children(fallback).map(node=>root.ownerDocument.importNode(node,true)));
      existing.setAttribute('count',existing.children.length);
    }
  }
}

const truthy = value => value==='1' || value==='true';
const styleIndex = value => Number.isInteger(Number(value)) && Number(value)>=0 ? Number(value) : 0;

export function validFontChange(property,value) {
  if (property==='family') return EXCEL_FONTS.includes(value);
  if (property==='bold') return value==='1' || value==='0';
  return property==='size' && /^\d{1,2}(?:\.\d)?$/.test(value) && Number(value)>=6 && Number(value)<=72;
}

function fontAppearance(node) {
  const weight=child(node,'b');
  return {
    family:child(node,'name')?.getAttribute('val') || defaultStyle.family,
    size:Number(child(node,'sz')?.getAttribute('val')) || defaultStyle.size,
    bold:Boolean(weight && !['0','false'].includes(weight.getAttribute('val'))),
  };
}

function fontWithChange(font,property,value) {
  const change=font.cloneNode(true);
  const name={family:'name',size:'sz',bold:'b'}[property];
  const node=child(change,name) ?? add(change,name);
  node.setAttribute('val',value);
  if (property==='family') child(change,'scheme')?.remove();
  return change;
}

function findColumn(sheet,column) {
  let cache=columnCache.get(sheet);
  if (!cache) columnCache.set(sheet,cache=new Map());
  if (cache.has(column)) return cache.get(column);
  let entry;
  for (const group of children(sheet,'cols')) {
    entry=children(group,'col').find(node=>column>=Number(node.getAttribute('min')) && column<=Number(node.getAttribute('max')));
    if (entry) break;
  }
  cache.set(column,entry);
  return entry;
}

export function getCellStyle(sheet,layout,row,column) {
  const entry=layout.rows.get(row);
  return entry?.cells.get(column)?.getAttribute('s')
    ?? (truthy(entry?.node.getAttribute('customFormat')) ? entry.node.getAttribute('s') : null)
    ?? findColumn(sheet,column)?.getAttribute('style') ?? '0';
}

function setColumnStyle(sheet,column,entry,style) {
  let group=entry?.parentElement ?? child(sheet,'cols');
  if (!group) {
    group=xmlChild(sheet,'cols');
    sheet.insertBefore(group,child(sheet,'sheetData'));
  }
  const col=entry ? entry.cloneNode(true) : xmlChild(group,'col');
  const min=Number(entry?.getAttribute('min')) || column;
  const max=Number(entry?.getAttribute('max')) || column;
  col.setAttribute('min',column);
  col.setAttribute('max',column);
  col.setAttribute('style',style);
  if (!entry) {
    const next=children(group,'col').find(item=>Number(item.getAttribute('min'))>column);
    group.insertBefore(col,next??null);
    return;
  }
  if (min<column) {
    const before=entry.cloneNode(true);
    before.setAttribute('max',column-1);
    group.insertBefore(before,entry);
  }
  group.insertBefore(col,entry);
  if (max>column) {
    const after=entry.cloneNode(true);
    after.setAttribute('min',column+1);
    group.insertBefore(after,entry);
  }
  entry.remove();
}

export function canFormatSheet(sheet) {
  const protection=child(sheet,'sheetProtection');
  return !protection || ['0','false'].includes(protection.getAttribute('sheet'));
}

export function formatColumn(sheet,layout,column,styles,property,value) {
  const entry=findColumn(sheet,column);
  const original=entry?.getAttribute('style') ?? '0';
  const style=styles.change(original,property,value);
  const edits=[];
  for (const [row,{node,cells}] of layout.rows) {
    const cell=cells.get(column);
    if (!cell) continue;
    const base=getCellStyle(sheet,layout,row,column);
    const next=styles.change(base,property,value);
    if (String(next)!==base && (cell.hasAttribute('s') || truthy(node.getAttribute('customFormat')))) edits.push([cell,next]);
  }
  if (String(style)===original && !edits.length) return false;
  if (String(style)!==original) {
    setColumnStyle(sheet,column,entry,style);
    columnCache.delete(sheet);
  }
  for (const [cell,next] of edits) cell.setAttribute('s',next);
  return true;
}

export async function loadWorkbookStyles(source,workbookPath,workbook,links) {
  const linked=[...links.values()].find(part=>part.type.endsWith('/styles'));
  const workbookDir=workbookPath.slice(0,workbookPath.lastIndexOf('/')+1);
  const relsPath=workbookDir+'_rels/'+workbookPath.slice(workbookDir.length)+'.rels';
  let stylePath=linked?.path ?? workbookDir+'styles.xml';
  if (!linked) {
    let suffix=0;
    while (source.entries.has(stylePath)) stylePath=workbookDir+`greenos-styles-${++suffix}.xml`;
  }
  const namespace=workbook.namespaceURI || 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const baseline=defaultStyles(namespace);
  let existing, canChange=true;
  if (linked) {
    try {
      existing=await source.xml(stylePath);
      canChange=!existing || existing.localName==='styleSheet';
    } catch { canChange=false; }
  }
  const root=canChange&&existing ? existing : baseline;
  if (root!==baseline) completeStyles(root,baseline);
  const fontsNode=child(root,'fonts');
  const xfsNode=child(root,'cellXfs');
  const fonts=children(fontsNode,'font');
  const xfs=children(xfsNode,'xf');
  const defaults={font:child(child(baseline,'fonts'),'font'),xf:child(child(baseline,'cellXfs'),'xf')};
  const serializer=new XMLSerializer();
  const fontIds=new Map(), xfIds=new Map(), commands=new Map(), appearances=new Map();
  let changed=false;

  function originalStyle(index) {
    return xfs[styleIndex(index)] ?? xfs[0] ?? defaults.xf;
  }

  function styleFont(xf) {
    const sourceXf=['0','false'].includes(xf.getAttribute('applyFont'))
      ? children(child(root,'cellStyleXfs'),'xf')[styleIndex(xf.getAttribute('xfId'))] ?? xf : xf;
    return fonts[styleIndex(sourceXf.getAttribute('fontId'))] ?? fonts[0] ?? defaults.font;
  }

  function intern(node,collection,items,indices) {
    if (!indices.size) {
      for (const [index,item] of items.entries()) indices.set(serializer.serializeToString(item),index);
    }
    const signature=serializer.serializeToString(node);
    if (indices.has(signature)) return indices.get(signature);
    if (items.length>=MAX_STYLES) throw new Error('В книге достигнут предел стилей Excel.');
    const id=items.length;
    items.push(node);
    collection.append(node);
    collection.setAttribute('count',items.length);
    indices.set(signature,id);
    changed=true;
    return id;
  }

  function appearance(index) {
    const id=styleIndex(index);
    if (!appearances.has(id)) appearances.set(id,fontAppearance(styleFont(originalStyle(id))));
    return appearances.get(id);
  }

  function change(index,property,value) {
    const key=index+':'+property+':'+value;
    if (commands.has(key)) return commands.get(key);
    const original=originalStyle(index);
    const font=styleFont(original);
    const current=appearance(index);
    if (property==='bold' ? current.bold===(value==='1') : String(current[property])===value) return styleIndex(index);
    if (!canChange) throw new Error('Таблица стилей книги повреждена.');
    const xf=original.cloneNode(true);
    xf.setAttribute('fontId',intern(fontWithChange(font,property,value),fontsNode,fonts,fontIds));
    xf.setAttribute('applyFont','1');
    const id=intern(xf,xfsNode,xfs,xfIds);
    appearances.delete(id);
    commands.set(key,id);
    return id;
  }

  async function writeParts(updates) {
    if (!changed) return;
    updates.set(stylePath,serializer.serializeToString(root));
    if (linked) return;
    const parse=new DOMParser();
    const xml=async (part,ns,tag) => updates.has(part)
      ? parse.parseFromString(updates.get(part),'application/xml').documentElement
      : (await source.xml(part)) ?? document.implementation.createDocument(ns,tag).documentElement;
    const rels=await xml(relsPath,REL_NS,'Relationships');
    const ids=new Set(children(rels,'Relationship').map(node=>node.getAttribute('Id')));
    let number=1;
    while (ids.has('rId'+number)) number++;
    const type=[...links.values()].find(part=>part.type.endsWith('/worksheet'))?.type;
    const relationType=type ? type.slice(0,type.lastIndexOf('/')) : REL_BASE;
    add(rels,'Relationship',{Id:'rId'+number,Type:relationType+'/styles',Target:encodeURI(stylePath.slice(workbookDir.length))});
    const typesPath='[Content_Types].xml';
    const types=await xml(typesPath,TYPES_NS,'Types');
    add(types,'Override',{PartName:'/'+encodeURI(stylePath),ContentType:STYLES_MIME});
    updates.set(relsPath,serializer.serializeToString(rels));
    updates.set(typesPath,serializer.serializeToString(types));
  }

  return {canChange,appearance,change,writeParts};
}
