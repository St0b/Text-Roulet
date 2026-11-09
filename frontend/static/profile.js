import {settings, emit} from './core.js';
import {state} from './storage.js';

const avatarKey = 'profile-avatar';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
let avatarUrl;
let writes = Promise.resolve();

function queueChange(action) {
  const result = writes.then(action);
  writes = result.catch(() => {});
  return result;
}

function showAvatar(blob) {
  const previous = avatarUrl;
  avatarUrl = blob ? URL.createObjectURL(blob) : undefined;
  emit('avatar');
  if (previous) URL.revokeObjectURL(previous);
}

export function renderAvatar(holder) {
  if (!holder) return;
  const initial = [...(String(settings.get('name') ?? '').trim() || 'g')][0].toLocaleUpperCase('ru');
  if (avatarUrl) {
    const image = document.createElement('img');
    image.src = avatarUrl;
    image.alt = '';
    holder.replaceChildren(image);
  } else holder.textContent = initial;
}

export function hasAvatar() { return Boolean(avatarUrl); }

export async function loadAvatar() {
  const blob = await state.get(avatarKey);
  if (blob instanceof Blob && IMAGE_TYPES.has(blob.type)) showAvatar(blob);
}

async function avatarBlob(file) {
  if (!IMAGE_TYPES.has(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('Выберите PNG, JPEG или WebP размером до 10 МБ.');
  }
  let image;
  try { image = await createImageBitmap(file); }
  catch { throw new Error('Не удалось открыть это изображение.'); }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  try {
    const {width, height} = image;
    const side = Math.min(width, height);
    canvas.getContext('2d').drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 256, 256);
  } finally {
    image.close();
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .88));
  if (!blob) throw new Error('Не удалось сохранить изображение.');
  return blob;
}

export function updateAvatar(file) {
  return queueChange(async () => {
    const blob = await avatarBlob(file);
    await state.set(avatarKey, blob);
    showAvatar(blob);
  });
}

export function removeAvatar() {
  return queueChange(async () => {
    await state.delete(avatarKey);
    showAvatar();
  });
}
