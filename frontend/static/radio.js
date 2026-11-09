import {$, $$, el, icon} from './core.js';

const stations = [
  {name: 'Main Mix', genre: 'Эклектика', url: 'https://stream.radioparadise.com/mp3-128'},
  {name: 'Mellow Mix', genre: 'Спокойная музыка', url: 'https://stream.radioparadise.com/mellow-192'},
  {name: 'Rock Mix', genre: 'Рок', url: 'https://stream.radioparadise.com/rock-192'},
  {name: 'Radio Record', genre: 'Танцевальная музыка', url: 'https://hls-01-radiorecord.hostingradio.ru/record/112/playlist.m3u8'},
];

export const radioApp = {
  id: 'radio', name: 'Радио', subtitle: 'Потоковая музыка', icon: 'music',
  singleton: true, width: 690, height: 440,

  mount(win) {
    win.body.innerHTML = `
      <div class="radio-page">
        <div class="radio-now">
          <span class="radio-art">${icon('music')}</span>
          <div class="grow">
            <span class="badge green">ИНТЕРНЕТ-РАДИО</span>
            <h2 class="radio-title">Выберите станцию</h2>
            <p class="radio-status" role="status">Выберите готовый канал или укажите адрес потока.</p>
          </div>
        </div>
        <div class="radio-controls">
          <button class="primary radio-play" type="button" disabled>${icon('play')}Слушать</button>
          <button class="radio-stop" type="button" disabled>Остановить</button>
          <label class="radio-volume">Громкость <input type="range" min="0" max="100" value="65"></label>
        </div>
        <h3>Радиостанции</h3>
        <div class="radio-stations"></div>
        <form class="radio-form">
          <label for="radio-address">Ссылка на поток или плейлист HLS (.m3u8)</label>
          <div class="row">
            <input id="radio-address" class="grow" type="url" required placeholder="https://…" spellcheck="false">
            <button type="submit">Подключиться</button>
          </div>
        </form>
      </div>`;

    const audio = el('audio', {preload: 'none', hidden: true});
    win.body.append(audio);
    const title = $('.radio-title', win.body);
    const status = $('.radio-status', win.body);
    const play = $('.radio-play', win.body);
    const stop = $('.radio-stop', win.body);
    const volume = $('.radio-volume input', win.body);
    const address = $('#radio-address', win.body);
    let selected;
    let hls;
    let playback = 0;
    audio.volume = Number(volume.value) / 100;

    function disconnect() {
      playback++;
      audio.pause();
      hls?.destroy();
      hls = undefined;
      audio.removeAttribute('src');
      audio.load();
      stop.disabled = true;
      play.disabled = !selected;
    }

    function failPlayback(message) {
      disconnect();
      status.textContent = message;
    }

    function requestPlayback(attempt) {
      play.disabled = true;
      audio.play().catch(error => {
        if (attempt !== playback || error.name === 'AbortError') return;
        if (error.name === 'NotAllowedError') {
          play.disabled = false;
          status.textContent = 'Нажмите «Слушать», чтобы начать воспроизведение.';
          return;
        }
        failPlayback('Поток недоступен. Проверьте ссылку и формат аудио.');
      });
    }

    async function playHls(url, attempt) {
      try {
        const {default: Hls} = await import('./vendor/hls/hls.min.mjs');
        if (attempt !== playback) return;
        if (!Hls.isSupported()) {
          failPlayback('Этот браузер не поддерживает воспроизведение HLS.');
          return;
        }
        hls = new Hls({enableWorker: false});
        const stream = hls;
        stream.on(Hls.Events.ERROR, (_event, details) => {
          if (attempt !== playback || !details.fatal) return;
          const code = details.response?.code;
          failPlayback(code >= 400
            ? `Сервер потока ответил HTTP ${code}.`
            : 'Не удалось загрузить HLS-поток. Проверьте доступность станции.');
        });
        stream.once(Hls.Events.MEDIA_ATTACHED, () => stream.loadSource(url));
        stream.once(Hls.Events.MANIFEST_PARSED, () => requestPlayback(attempt));
        stream.attachMedia(audio);
      } catch {
        if (attempt === playback) failPlayback('Не удалось запустить HLS-плеер.');
      }
    }

    function playStation(station) {
      disconnect();
      selected = station;
      title.textContent = station.name;
      win.setTitle(`${station.name} — Радио`);
      address.value = station.url;
      for (const button of $$('.radio-station', win.body)) {
        button.setAttribute('aria-pressed', String(button.dataset.url === station.url));
      }
      status.textContent = 'Подключение к эфиру…';
      play.disabled = true;
      stop.disabled = false;
      const attempt = playback;
      const isHls = /\.m3u8$/i.test(new URL(station.url).pathname);
      if (isHls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
        playHls(station.url, attempt);
        return;
      }
      audio.src = station.url;
      requestPlayback(attempt);
    }

    for (const station of stations) {
      const button = el('button', {class: 'radio-station', type: 'button', 'data-url': station.url, 'aria-pressed': 'false'},
        el('strong', {}, station.name), el('small', {}, station.genre));
      button.onclick = () => playStation(station);
      $('.radio-stations', win.body).append(button);
    }

    $('.radio-form', win.body).onsubmit = event => {
      event.preventDefault();
      let url;
      try {
        url = new URL(address.value.trim());
      } catch {
        status.textContent = 'Не удалось прочитать адрес потока.';
        return;
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        status.textContent = 'Укажите прямую ссылку на поток по HTTP или HTTPS.';
        return;
      }
      if (location.protocol === 'https:' && url.protocol === 'http:') {
        status.textContent = 'Для этой страницы нужна HTTPS-ссылка на поток.';
        return;
      }
      playStation(stations.find(station => station.url === url.href) || {name: url.host, url: url.href});
    };

    audio.onplaying = () => { status.textContent = '● В эфире'; };
    audio.onwaiting = () => { if (!audio.paused) status.textContent = 'Буферизация…'; };
    audio.onerror = () => {
      if (!audio.hasAttribute('src') || !audio.error) return;
      failPlayback('Поток недоступен. Проверьте ссылку и формат аудио.');
    };
    audio.onended = () => {
      disconnect();
      status.textContent = 'Трансляция завершилась.';
    };
    play.onclick = () => {
      if (audio.hasAttribute('src')) requestPlayback(playback);
      else if (selected) playStation(selected);
    };
    stop.onclick = () => {
      disconnect();
      status.textContent = 'Остановлено.';
    };
    volume.oninput = () => { audio.volume = Number(volume.value) / 100; };

    return disconnect;
  },
};
