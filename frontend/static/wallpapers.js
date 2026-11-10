import {emit, settings, uid} from './core.js';
import {state, transaction} from './storage.js';

export const WALLPAPER_PRESETS = [
  ['hills', 'Зелёные холмы'], ['midnight', 'Полночь'], ['mist', 'Туман'], ['grid', 'Сетка'],
];
export const WALLPAPER_ACCEPT = 'image/png,image/jpeg,image/webp';
const types = new Set(WALLPAPER_ACCEPT.split(','));
const presetIds = new Set(WALLPAPER_PRESETS.map(([id]) => id));
const libraryKey = 'desktop-wallpapers';
const maxFile = 15 * 1024 * 1024;
const maxSavedFile = 3 * 1024 * 1024;
const maxWallpapers = 12;

let library = new Map();
let loading;
let loaded = false;
let writes = Promise.resolve();

function validRecords(value) {
  if (!Array.isArray(value)) return [];
  const records = new Map();
  for (const item of value) {
    if (/^wallpaper-[\da-f-]{36}$/.test(item?.id) && typeof item.name === 'string'
        && item.blob instanceof Blob && types.has(item.blob.type) && item.blob.size <= maxSavedFile) {
      records.set(item.id, {id:item.id, name:item.name.slice(0, 100), blob:item.blob});
    }
  }
  return [...records.values()].slice(0, maxWallpapers);
}

function install(records) {
  const previous = library;
  library = new Map(records.map(({id, name, blob}) =>
    [id, {id, name, url:previous.get(id)?.url ?? URL.createObjectURL(blob)}]));
  emit('wallpapers');
  for (const [id, wallpaper] of previous) {
    if (!library.has(id)) URL.revokeObjectURL(wallpaper.url);
  }
}

export function loadWallpapers() {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = state.get(libraryKey).then(value => {
      loaded = true;
      install(validRecords(value));
    }).finally(() => { loading = undefined; });
  }
  return loading;
}

export const customWallpapers = () => [...library.values()];

export function applyWallpaper(desktop) {
  const selection = settings.get('wallpaper');
  const custom = library.get(selection);
  desktop.dataset.wallpaper = custom ? 'custom' : presetIds.has(selection) ? selection : 'hills';
  const landscape = desktop.querySelector('.landscape');
  landscape.style.backgroundImage = custom ? `url("${custom.url}")` : '';
}

function queueChange(action) {
  const result = writes.then(action);
  writes = result.catch(() => {});
  return result;
}

async function updateLibrary(update) {
  let records, error;
  await transaction('state', 'readwrite', store => {
    const request = store.get(libraryKey);
    request.onsuccess = () => {
      try {
        records = update(validRecords(request.result));
        store.put(records, libraryKey);
      } catch (failure) { error = failure; }
    };
    return request;
  });
  if (error) throw error;
  install(records);
}

async function wallpaperBlob(file) {
  if (!types.has(file.type) || file.size > maxFile) {
    throw new Error('Выберите PNG, JPEG или WebP размером до 15 МБ.');
  }
  let image;
  try { image = await createImageBitmap(file); }
  catch { throw new Error('Не удалось открыть это изображение.'); }
  try {
    const {width, height} = image;
    if (!width || !height || width * height > 60_000_000) throw new Error('Размер изображения не должен превышать 60 мегапикселей.');
    const scale = Math.min(1, 3840 / Math.max(width, height), Math.sqrt(8_294_400 / (width * height)));
    const canvas = document.createElement('canvas');
    for (const factor of [1, .75, .5]) {
      canvas.width = Math.max(1, Math.round(width * scale * factor));
      canvas.height = Math.max(1, Math.round(height * scale * factor));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .86));
      if (blob && types.has(blob.type) && blob.size <= maxSavedFile) return blob;
    }
    throw new Error('Не удалось уменьшить изображение до 3 МБ.');
  } finally { image.close(); }
}

export function addWallpaper(file) {
  return queueChange(async () => {
    await loadWallpapers();
    const blob = await wallpaperBlob(file);
    const name = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 100) || 'Свои обои';
    const wallpaper = {id:`wallpaper-${uid()}`, name, blob};
    await updateLibrary(records => {
      if (records.length >= maxWallpapers) throw new Error('Можно сохранить до 12 своих обоев. Удалите один из вариантов.');
      return [...records, wallpaper];
    });
    settings.set({wallpaper:wallpaper.id});
  });
}

export function removeWallpaper(id) {
  return queueChange(async () => {
    await loadWallpapers();
    await updateLibrary(records => records.filter(wallpaper => wallpaper.id !== id));
    if (settings.get('wallpaper') === id) settings.set({wallpaper:'hills'});
  });
}
