"""Compatibility export for the browser page."""

from frontend.desktop import PAGE as _PAGE
from frontend.apps import APPS_CSS, APPS_HTML, APPS_JS

_DESKTOP_FIX_CSS = """
<style>
.task-app.active { border-color: var(--green); background: rgba(54,240,120,.16); }
.app-grid { position:absolute; top:145px; left:38px; display:grid; grid-template-columns:repeat(2,86px); grid-template-rows:repeat(4,96px); grid-auto-flow:column; gap:22px 30px; width:202px; max-width:calc(100% - 76px); }
.workspace > #openApp, .workspace > #openGame { position:absolute; top:38px; left:38px; }
.workspace > #openGame { left:154px; margin-left:0 !important; }
.settings-task { display:inline-grid; place-items:center; width:32px; height:32px; margin-right:10px; border:1px solid var(--line); color:var(--muted); background:rgba(18,53,28,.7); }
.settings-task:hover, .settings-task.active { color:var(--green); border-color:var(--green); background:rgba(54,240,120,.16); }
.taskbar { position:absolute; }
.taskbar .clock { position:absolute; right:16px; }
.taskbar .settings-task { position:absolute; right:58px; margin-right:0; }
.app-window[data-window="settings"] { position:fixed; z-index:20; inset:auto 16px 58px auto; width:286px; height:auto; max-height:calc(100vh - 80px); transform:translateY(14px); opacity:0; pointer-events:none; transition:opacity .18s, transform .18s; }
.app-window[data-window="settings"]:not(.hidden) { transform:translateY(0); opacity:1; pointer-events:auto; }
.app-window[data-window="settings"] .app-content { padding:18px; }
.terminal-content { min-height:0; display:grid; grid-template-rows:1fr auto; padding:16px; background:#020503; color:#7dff9b; font:13px "Courier New",monospace; }
.terminal-content .terminal-output { height:auto; min-height:0; margin:0; border:0; padding:12px 0; color:#7dff9b; background:transparent; line-height:1.6; }
.terminal-line { display:flex; align-items:center; gap:8px; border-top:1px solid rgba(54,240,120,.16); padding-top:12px; color:var(--green); }
.terminal-line .terminal-input { min-height:0; border:0; padding:0; color:#d7ffe0; background:transparent; caret-color:var(--green); }
.calculator-content { padding:18px; }
.calc-display { width:100%; height:58px; margin-bottom:12px; border:1px solid var(--line); padding:8px 12px; color:var(--ink); background:#06110a; font-size:28px; text-align:right; }
.calc-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; }
.calc-grid button { min-height:48px; border:1px solid var(--line); color:var(--ink); background:#12351e; font-size:17px; }
.calc-grid button:hover { color:var(--bg); background:var(--green); }
.calc-grid button[data-calc="/"], .calc-grid button[data-calc="*"], .calc-grid button[data-calc="-"], .calc-grid button[data-calc="+"] { color:var(--green); }
.calc-zero { grid-column:span 2; }
.calc-equals { color:var(--bg) !important; background:var(--green) !important; }
.mines-bar { display:flex; align-items:center; gap:16px; margin-bottom:16px; color:var(--green); }
.mines-bar strong { flex:1; }
.mines-bar .app-button { min-height:32px; padding:6px 10px; font-size:10px; }
.mine-cell[data-count="1"] { color:#55b7ff; }.mine-cell[data-count="2"] { color:#65e06c; }.mine-cell[data-count="3"] { color:#ff756b; }.mine-cell[data-count="4"] { color:#bd8cff; }.mine-cell[data-count="5"] { color:#ffad5c; }
.app-grid .app-icon.extra { width:86px; height:96px; margin:0; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; }
.app-grid .icon-tile { flex:0 0 60px; }
.app-grid .app-label { display:block; max-width:86px; min-height:28px; }
.app-window { border-radius:2px; }
.app-content { background:linear-gradient(135deg,rgba(10,30,17,.98),rgba(6,17,10,.98)); }
.app-content h2 { padding-bottom:12px; border-bottom:1px solid var(--line); }
.app-content small { display:block; margin-top:5px; color:var(--muted); font-size:10px; }
.file-item, .notification, .store-card, .metric { min-height:58px; display:flex; flex-direction:column; justify-content:center; }
.app-button { min-height:38px; }
body.no-animations *, body.no-animations *::before, body.no-animations *::after { animation-duration:0s !important; transition-duration:0s !important; }
@media (max-width:700px) { .app-grid { top:145px; left:38px; grid-template-columns:repeat(2,86px); grid-template-rows:repeat(4,96px); gap:18px 30px; max-width:calc(100% - 76px); } .app-window[data-window="settings"] { right:10px; bottom:58px; width:min(286px,calc(100vw - 20px)); } }
.game-window { position:absolute; z-index:5; inset:14% 22%; display:grid; grid-template-rows:44px 1fr; overflow:hidden; border:1px solid var(--line); background:rgba(8,20,12,.98); box-shadow:0 24px 80px rgba(0,0,0,.45); }
.game-window.hidden { display:none; }
.game-head { display:flex; align-items:center; gap:14px; padding:0 15px; border-bottom:1px solid var(--line); background:rgba(15,42,23,.92); }
.game-title { flex:1; color:var(--green); font-size:12px; }
.game-controls { display:flex; gap:7px; }
.game-controls button { width:22px; height:22px; padding:0; border:1px solid var(--line); color:var(--muted); background:transparent; }
.game-controls button:hover { color:var(--ink); border-color:var(--green); }
.game-body { display:grid; place-items:center; gap:12px; padding:22px; }
.game-body canvas { width:min(100%,420px); aspect-ratio:1; border:1px solid var(--line); background:#06110a; image-rendering:pixelated; }
.game-help { margin:0; color:var(--muted); font-size:11px; text-align:center; }
.game-score { color:var(--green); font-size:12px; }
@media (max-width:700px) { .game-window { inset:8% 10px 12%; } }
</style>
"""

_DESKTOP_FIX_HTML = r'''
<button class="app-icon" id="openGame" type="button" style="margin-left:24px"><span class="icon-tile">▦</span><span class="app-label">Byte Snake</span></button>
<section class="game-window hidden" id="gameWindow" aria-label="Byte Snake">
	<header class="game-head"><span class="game-title">▦ Byte Snake</span><span class="game-controls"><button id="minimizeGame" type="button">−</button><button id="closeGame" type="button">×</button></span></header>
	<div class="game-body"><span class="game-score" id="gameScore">SCORE 0</span><canvas id="snakeCanvas" width="360" height="360"></canvas><p class="game-help">Стрелки или WASD для движения · Пробел начать заново</p></div>
</section>
'''

_SETTINGS_TASKBAR = '<button class="settings-task" id="settingsTask" type="button" aria-label="Настройки">⚙</button>'

_DESKTOP_FIX_SCRIPT = r"""
<script>
(function () {
	const app = document.querySelector("#appWindow");
	const search = document.querySelector("#searching");
	const task = document.querySelector("#taskApp");
	const icon = document.querySelector("#openApp");
	const minimize = document.querySelector("#minimizeApp");
	const close = document.querySelector("#closeApp");
	const settingsTask = document.querySelector("#settingsTask");
	const settingsWindow = document.querySelector('[data-window="settings"]');
	const head = app.querySelector(".window-head");
	function hideSearch() {
		search.style.transition = "none";
		search.classList.remove("visible");
		search.setAttribute("aria-hidden", "true");
	}
	function syncSearch() {
		const waiting = document.querySelector("#status").classList.contains("waiting");
		const visible = waiting && !app.classList.contains("hidden") && !app.classList.contains("minimized");
		if (!visible) {
			hideSearch();
			return;
		}
		search.style.transition = "opacity .3s";
		search.classList.add("visible");
		search.setAttribute("aria-hidden", "false");
	}

	function restore() {
		app.classList.remove("hidden", "minimized");
		task.classList.add("active");
		if (!clientId) {
			request("/api/join", { method: "POST", body: "{}" }).then((data) => {
				clientId = data.clientId;
				updateState(data);
				handleEvents(data.events);
				poll();
			}).catch(() => {
				status.textContent = "сервер недоступен";
				status.className = "status disconnected";
			});
		} else syncSearch();
	}

	function leaveChat() {
		if (!clientId) return;
		navigator.sendBeacon("/api/leave", new Blob([JSON.stringify({ id: clientId })], { type: "application/json" }));
		clientId = "";
		isMatched = false;
		hideSearch();
	}

	function toggleFromTaskbar() {
		if (app.classList.contains("hidden")) restore();
		else if (app.classList.contains("minimized")) restore();
		else {
			app.classList.add("minimized");
			task.classList.remove("active");
			syncSearch();
		}
	}

	icon.onclick = restore;
	task.onclick = toggleFromTaskbar;
	minimize.onclick = () => {
		if (app.classList.contains("minimized")) restore();
		else {
			hideSearch();
			app.classList.add("minimized");
			task.classList.remove("active");
		}
	};
	close.onclick = () => {
		leaveChat();
		hideSearch();
		app.classList.add("hidden");
		task.classList.remove("active");
	};
	settingsTask.onclick = () => {
		const isOpen = !settingsWindow.classList.contains("hidden");
		settingsWindow.classList.toggle("hidden", isOpen);
		settingsTask.classList.toggle("active", !isOpen);
	};
	settingsWindow.querySelector("[data-close-window]").addEventListener("click", () => settingsTask.classList.remove("active"));

	new MutationObserver(syncSearch).observe(app, { attributes: true, attributeFilter: ["class"] });
	new MutationObserver(syncSearch).observe(document.querySelector("#status"), { attributes: true, attributeFilter: ["class"] });
})();
</script>
"""

_GAME_SCRIPT = r'''
<script>
(function () {
	const windowEl = document.querySelector("#gameWindow");
	const canvas = document.querySelector("#snakeCanvas");
	const context = canvas.getContext("2d");
	const scoreLabel = document.querySelector("#gameScore");
	const grid = 18;
	const cell = canvas.width / grid;
	let snake = [{ x: 9, y: 9 }], food = { x: 4, y: 5 }, direction = { x: 1, y: 0 }, next = direction, score = 0, timer;
	function draw() {
		context.fillStyle = "#06110a";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.strokeStyle = "rgba(54,240,120,.08)";
		for (let i = 0; i <= grid; i++) { context.beginPath(); context.moveTo(i * cell, 0); context.lineTo(i * cell, canvas.height); context.stroke(); context.beginPath(); context.moveTo(0, i * cell); context.lineTo(canvas.width, i * cell); context.stroke(); }
		context.fillStyle = "#f0c936"; context.fillRect(food.x * cell + 3, food.y * cell + 3, cell - 6, cell - 6);
		snake.forEach((part, index) => { context.fillStyle = index ? "#239f50" : "#36f078"; context.fillRect(part.x * cell + 2, part.y * cell + 2, cell - 4, cell - 4); });
	}
	function reset() { snake = [{ x: 9, y: 9 }]; food = { x: 4, y: 5 }; direction = { x: 1, y: 0 }; next = direction; score = 0; scoreLabel.textContent = "SCORE 0"; draw(); clearInterval(timer); timer = setInterval(step, 130); }
	function step() { direction = next; const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y }; if (head.x < 0 || head.y < 0 || head.x >= grid || head.y >= grid || snake.some(part => part.x === head.x && part.y === head.y)) { reset(); return; } snake.unshift(head); if (head.x === food.x && head.y === food.y) { score++; scoreLabel.textContent = `SCORE ${score}`; do { food = { x: Math.floor(Math.random() * grid), y: Math.floor(Math.random() * grid) }; } while (snake.some(part => part.x === food.x && part.y === food.y)); } else snake.pop(); draw(); }
	function openGame() { windowEl.classList.remove("hidden"); reset(); }
	document.querySelector("#openGame").onclick = openGame;
	document.querySelector("#minimizeGame").onclick = () => windowEl.classList.toggle("hidden");
	document.querySelector("#closeGame").onclick = () => { windowEl.classList.add("hidden"); clearInterval(timer); };
	document.addEventListener("keydown", event => { const keys = { ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 } }; const value = keys[event.key]; if (value && value.x !== -direction.x && value.y !== -direction.y) { next = value; event.preventDefault(); } if (event.code === "Space" && !windowEl.classList.contains("hidden")) reset(); });
	draw();
})();
</script>
'''

_TOUCH_GAMES_SCRIPT = r'''
<script>
(function () {
	let startX = 0;
	let startY = 0;
	function bindSwipe(element) {
		if (!element) return;
		element.addEventListener("touchstart", (event) => {
			const touch = event.changedTouches[0];
			startX = touch.clientX;
			startY = touch.clientY;
		}, { passive: true });
		element.addEventListener("touchend", (event) => {
			const touch = event.changedTouches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;
			if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
			const key = Math.abs(dx) > Math.abs(dy)
				? (dx > 0 ? "ArrowRight" : "ArrowLeft")
				: (dy > 0 ? "ArrowDown" : "ArrowUp");
			document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
		});
	}
	bindSwipe(document.querySelector("#snakeCanvas"));
	bindSwipe(document.querySelector("#twoBoard"));
})();
</script>
'''

PAGE = _PAGE.replace(
	'<section class="window" id="appWindow">',
	'<section class="window hidden" id="appWindow">',
).replace(
	'request("/api/join",{method:"POST",body:"{}"}).then(data=>{clientId=data.clientId;updateState(data);handleEvents(data.events);poll()}).catch(()=>{status.textContent="сервер недоступен";status.className="status disconnected"});',
	'',
).replace(
	".searching{position:absolute;z-index:2;",
	".searching{position:absolute;z-index:6;",
).replace("</style>", APPS_CSS.replace(".file-list,", "") + _DESKTOP_FIX_CSS + "</style>").replace("</main>", _DESKTOP_FIX_HTML + APPS_HTML + "</main>").replace('<span class="clock" id="clock"></span>', _SETTINGS_TASKBAR + '<span class="clock" id="clock"></span>').replace("</body>", _DESKTOP_FIX_SCRIPT + _GAME_SCRIPT + APPS_JS + _TOUCH_GAMES_SCRIPT + "</body>")

__all__ = ["PAGE"]
