import {$, el, icon} from './core.js';
import {wm} from './windows.js';

const bookmarks = [
  {name: 'Документация Linux', url: 'https://docs.kernel.org/'},
  {name: 'Buildroot', url: 'https://buildroot.org/'},
  {name: 'Википедия', url: 'https://ru.wikipedia.org/'},
];

const bareAddress = /^(?:localhost|(?:[\p{L}\d-]+\.)+[\p{L}\d-]+|\[[\da-f:]+\])(?::\d+)?(?:[/?#].*)?$/iu;
const loopback = /^(?:localhost|127(?:\.\d+){3}|\[::1\])(?=[:/?#]|$)/i;

function parseAddress(value) {
  const address = bareAddress.test(value) ? `${loopback.test(value) ? 'http' : 'https'}://${value}` : value;
  if (!/^[a-z][a-z\d+.-]*:/i.test(address)) return {type: 'search', value};
  const url = new URL(address);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Укажите адрес сайта по HTTP или HTTPS.');
  }
  if (location.protocol === 'https:' && url.protocol === 'http:') {
    throw new Error('Для этой страницы нужен HTTPS-адрес сайта.');
  }
  return {type: 'page', value: url.href};
}

export const browserApp = {
  id: 'browser', name: 'Интернет', subtitle: 'Встроенный браузер', icon: 'globe', width: 920, height: 630,

  mount(win) {
    win.body.innerHTML = `
      <form class="toolbar address-form">
        <button class="web-back icon-button" type="button" title="Назад по адресам" aria-label="Назад по адресам">${icon('back')}</button>
        <button class="web-forward icon-button" type="button" title="Вперёд по адресам" aria-label="Вперёд по адресам">${icon('arrow')}</button>
        <button class="web-reload icon-button" type="button" title="Обновить" aria-label="Обновить">${icon('refresh')}</button>
        <button class="web-home icon-button" type="button" title="Начальная страница" aria-label="Начальная страница">${icon('home')}</button>
        <input class="grow web-address" type="text" placeholder="Адрес или поиск по Википедии" aria-label="Адрес или поиск по Википедии" autocomplete="off" spellcheck="false">
        <button class="primary" type="submit">Открыть</button>
      </form>
      <div class="web-content"></div>
      <div class="statusbar web-status" role="status"></div>`;

    const q = selector => $(selector, win.body);
    const content = q('.web-content');
    const address = q('.web-address');
    const status = q('.web-status');
    const history = [{type: 'home', value: ''}];
    let position = 0;
    let search;
    let frame;

    function navigate(entry) {
      const current = history[position];
      if (entry.type !== current.type || entry.value !== current.value) {
        history.splice(position + 1, history.length, entry);
        position++;
      }
      render();
    }

    function openPage(url) {
      navigate({type: 'page', value: url});
    }

    function showHome() {
      const home = el('div', {class: 'browser-page'},
        el('span', {class: 'badge green'}, 'GREENOS / WEB'),
        el('h1', {}, 'Интернет'),
        el('p', {}, 'Введите адрес сайта или найдите статью в Википедии.'));
      const grid = el('div', {class: 'bookmark-grid'});
      for (const {name, url} of bookmarks) {
        grid.append(el('button', {class: 'bookmark', type: 'button', onclick: () => openPage(url)},
          el('strong', {}, name), el('small', {}, new URL(url).hostname)));
      }
      home.append(grid);
      content.append(home);
    }

    async function showSearch(query) {
      const request = new AbortController();
      search = request;
      const results = el('div', {class: 'browser-page'}, el('h2', {}, `Поиск по Википедии: ${query}`));
      content.append(results);
      status.textContent = 'Ищем статьи…';
      const url = new URL('https://ru.wikipedia.org/w/api.php');
      url.search = new URLSearchParams({action: 'opensearch', origin: '*', search: query, limit: '8', format: 'json'});
      try {
        const response = await fetch(url, {signal: request.signal, credentials: 'omit'});
        if (!response.ok) throw new Error('Поиск недоступен.');
        const [, titles, , links] = await response.json();
        if (request.signal.aborted) return;
        const list = el('div', {class: 'bookmark-grid'});
        titles.forEach((title, index) => {
          const link = new URL(links[index]);
          if (link.origin !== url.origin) return;
          list.append(el('button', {class: 'bookmark', type: 'button', onclick: () => openPage(link.href)},
            el('strong', {}, title), el('small', {}, 'Википедия')));
        });
        results.append(list);
        status.textContent = list.childElementCount ? `Статей найдено: ${list.childElementCount}` : 'Статьи не найдены.';
      } catch {
        if (!request.signal.aborted) status.textContent = 'Поиск недоступен. Попробуйте ещё раз или введите адрес сайта.';
      }
    }

    function render() {
      search?.abort();
      frame = null;
      content.replaceChildren();
      const {type, value} = history[position];
      address.value = value;
      q('.web-back').disabled = position === 0;
      q('.web-forward').disabled = position === history.length - 1;
      q('.web-reload').disabled = type === 'home';
      win.setTitle(type === 'page' ? `${new URL(value).host} — Интернет` : 'Интернет');
      status.textContent = 'Некоторые сайты запрещают встраивание.';
      if (type === 'home') showHome();
      if (type === 'search') showSearch(value);
      if (type === 'page') {
        const url = new URL(value);
        const sandbox = url.origin === location.origin ? 'allow-scripts allow-forms' : 'allow-scripts allow-forms allow-same-origin';
        frame = el('iframe', {class: 'web-frame', src: url.href, title: `Страница ${url.host}`, sandbox, referrerpolicy: 'no-referrer'});
        content.append(frame);
        status.textContent = 'Если страница не отображается, сайт может запрещать встраивание.';
      }
    }

    q('.address-form').onsubmit = event => {
      event.preventDefault();
      const value = address.value.trim();
      if (!value) return;
      try {
        navigate(parseAddress(value));
      } catch (error) {
        status.textContent = error instanceof TypeError ? 'Не удалось прочитать адрес сайта.' : error.message;
      }
    };
    q('.web-back').onclick = () => { position--; render(); };
    q('.web-forward').onclick = () => { position++; render(); };
    q('.web-reload').onclick = render;
    q('.web-home').onclick = () => navigate({type: 'home', value: ''});
    window.addEventListener('blur', () => {
      if (frame && document.activeElement === frame && !win.element.hidden) wm.focus(win);
    }, {signal: win.abort.signal});
    render();

    return () => search?.abort();
  },
};
