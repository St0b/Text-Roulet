"""Compatibility export for the browser page."""

from frontend.desktop import PAGE as _PAGE

_DESKTOP_FIX_CSS = """
<style>
.task-app.active { border-color: var(--green); background: rgba(54,240,120,.16); }
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

_DESKTOP_FIX_SCRIPT = r"""
<script>
(function () {
	const app = document.querySelector("#appWindow");
	const search = document.querySelector("#searching");
	const task = document.querySelector("#taskApp");
	const icon = document.querySelector("#openApp");
	const minimize = document.querySelector("#minimizeApp");
	const close = document.querySelector("#closeApp");
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
		syncSearch();
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
		hideSearch();
		app.classList.add("hidden");
		task.classList.remove("active");
	};

	new MutationObserver(syncSearch).observe(app, { attributes: true, attributeFilter: ["class"] });
	new MutationObserver(syncSearch).observe(document.querySelector("#status"), { attributes: true, attributeFilter: ["class"] });
	restore();
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

PAGE = _PAGE.replace(
	".searching{position:absolute;z-index:2;",
	".searching{position:absolute;z-index:6;",
).replace("</style>", _DESKTOP_FIX_CSS + "</style>").replace("</main>", _DESKTOP_FIX_HTML + "</main>").replace("</body>", _DESKTOP_FIX_SCRIPT + _GAME_SCRIPT + "</body>")

__all__ = ["PAGE"]
