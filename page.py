"""Browser UI served by the Text Roulette server."""

PAGE = r'''<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Text Roulette</title>
  <style>
    :root { --ink:#d7ffe0; --muted:#72a57c; --green:#36f078; --deep:#07130c; --panel:rgba(10,30,17,.82); --line:rgba(82,255,126,.2); }
    * { box-sizing:border-box; }
    body { margin:0; height:100vh; overflow:hidden; color:var(--ink); background:#050b07; font-family:"Courier New",monospace; }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.2; background-image:linear-gradient(rgba(54,240,120,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(54,240,120,.06) 1px,transparent 1px); background-size:34px 34px; }
    .shell { width:min(100% - 32px,1020px); height:100vh; min-height:0; margin:auto; padding:28px 0; display:grid; grid-template-rows:auto minmax(0,1fr) auto; gap:18px; }
    header,.chat,footer { position:relative; z-index:1; }
    header { display:flex; align-items:end; justify-content:space-between; gap:20px; }
    .eyebrow { margin:0 0 8px; color:var(--green); font-size:12px; letter-spacing:.16em; }
    h1 { margin:0; font-size:clamp(28px,5vw,54px); letter-spacing:.04em; }
    .subtitle { margin:10px 0 0; color:var(--muted); font-size:13px; }
    .status { border:1px solid var(--line); padding:10px 13px; color:var(--green); font-size:12px; white-space:nowrap; transition:color .2s,border-color .2s; }
    .status.waiting { color:#f0c936; border-color:rgba(240,201,54,.45); }
    .status.matched { color:var(--green); border-color:rgba(54,240,120,.45); }
    .status.reconnecting { color:#ff9f43; border-color:rgba(255,159,67,.45); }
    .status.disconnected { color:#ff5c5c; border-color:rgba(255,92,92,.45); }
    .status::before { content:"●"; margin-right:8px; }
    .chat { min-height:0; height:100%; display:grid; grid-template-rows:auto minmax(0,1fr) auto; overflow:hidden; border:1px solid var(--line); background:var(--panel); box-shadow:0 0 60px rgba(22,180,75,.1); }
    .chat-top { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--line); }
    .partner-label { color:var(--muted); font-size:12px; }
    .partner-name { display:block; margin-top:4px; color:var(--green); font-size:17px; }
    button { font:inherit; cursor:pointer; }
    .next { border:1px solid var(--green); padding:10px 14px; color:var(--green); background:transparent; }
    .next:hover,.send:hover { color:var(--deep); background:var(--green); }
    .messages { min-height:0; padding:25px 22px; overflow-y:auto; scrollbar-width:thin; scrollbar-color:var(--green) rgba(54,240,120,.08); scrollbar-gutter:stable; }
    .messages::-webkit-scrollbar { width:8px; }
    .messages::-webkit-scrollbar-track { background:rgba(54,240,120,.06); border-left:1px solid rgba(82,255,126,.1); }
    .messages::-webkit-scrollbar-thumb { border:2px solid transparent; border-radius:0; background:var(--green); background-clip:padding-box; }
    .messages::-webkit-scrollbar-thumb:hover { background:#9affb2; background-clip:padding-box; }
    .message { max-width:78%; margin-bottom:18px; line-height:1.55; animation:appear .25s ease-out; }
    .message .meta { margin-bottom:4px; color:var(--muted); font-size:11px; }
    .message.you { margin-left:auto; text-align:right; }
    .message.you .meta { color:var(--green); }
    .bubble { display:inline-block; padding:11px 14px; border:1px solid var(--line); background:rgba(24,68,37,.45); text-align:left; }
    .you .bubble { border-color:rgba(54,240,120,.45); background:rgba(19,76,37,.3); }
    .composer { display:grid; grid-template-columns:1fr auto; gap:10px; padding:16px; border-top:1px solid var(--line); }
    input { width:100%; border:1px solid var(--line); padding:14px; outline:none; color:var(--ink); background:rgba(0,0,0,.24); font:inherit; }
    input:focus { border-color:var(--green); box-shadow:0 0 0 2px rgba(54,240,120,.1); }
    input:disabled { opacity:.45; }
    .send { border:1px solid var(--green); padding:0 19px; color:var(--deep); background:var(--green); }
    .send:disabled { cursor:not-allowed; opacity:.45; }
    footer { display:flex; justify-content:space-between; color:var(--muted); font-size:11px; }
    @keyframes appear { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
    @media (max-width:620px) { .shell { width:min(100% - 20px,1020px); padding:16px 0; gap:12px; } header { align-items:start; flex-direction:column; gap:14px; } .status { align-self:stretch; } .chat { min-height:0; } .message { max-width:92%; } .chat-top { padding:15px; } .messages { padding:20px 15px; } .composer { padding:10px; } .send { padding:0 13px; } }
  </style>
</head>
<body>
  <main class="shell">
    <header><div><p class="eyebrow">ANONYMOUS / TEXT ONLY</p><h1>TEXT ROULETTE</h1><p class="subtitle">Один случайный собеседник. Никаких профилей и картинок.</p></div><div class="status">подключение</div></header>
    <section class="chat" aria-label="Чат">
      <div class="chat-top"><div><span class="partner-label">СЕЙЧАС В ЧАТЕ</span><strong class="partner-name" id="partnerName">подключение...</strong></div><button class="next" id="nextButton" type="button">Новый чат ↗</button></div>
      <div class="messages" id="messages" aria-live="polite"></div>
      <form class="composer" id="composer"><input id="messageInput" autocomplete="off" maxlength="500" placeholder="Напишите сообщение..." aria-label="Сообщение" disabled><button class="send" type="submit" disabled>Отправить</button></form>
    </section>
    <footer><span>TEXT ROULETTE / REAL USERS</span><span>сообщения не сохраняются</span></footer>
  </main>
  <script>
    const messages = document.querySelector("#messages"), input = document.querySelector("#messageInput"), partnerName = document.querySelector("#partnerName"), status = document.querySelector(".status"), send = document.querySelector(".send");
    let clientId = "", isMatched = false, pollInFlight = false, pollDelay = 1000;
    function addMessage(author, text, isYou = false) { const item = document.createElement("article"), meta = document.createElement("div"), bubble = document.createElement("div"); item.className = `message${isYou ? " you" : ""}`; meta.className = "meta"; meta.textContent = author; bubble.className = "bubble"; bubble.textContent = text; item.append(meta, bubble); messages.append(item); messages.scrollTop = messages.scrollHeight; }
    async function request(path, options = {}) { const response = await fetch(path, { cache:"no-store", headers:{"Content-Type":"application/json"}, ...options }); if (!response.ok) throw new Error("Сервер недоступен"); return response.json(); }
    function updateState(data) { isMatched = data.state === "matched"; partnerName.textContent = isMatched ? data.partner : "поиск собеседника..."; status.textContent = isMatched ? "собеседник найден" : "ожидание собеседника"; status.className = `status ${isMatched ? "matched" : "waiting"}`; input.disabled = !isMatched; send.disabled = !isMatched; }
    function handleEvents(events) { for (const event of events) { if (event.type === "matched") updateState({state:"matched", partner:event.partner}); else if (event.type === "message") addMessage(event.from, event.text); else if (event.type === "left") updateState({state:"waiting"}); } }
    async function poll() { if (!clientId || pollInFlight) return; pollInFlight = true; try { const data = await request(`/api/poll?id=${encodeURIComponent(clientId)}`); updateState(data); handleEvents(data.events); pollDelay = 1000; } catch (error) { status.textContent = "повторное подключение..."; status.className = "status reconnecting"; pollDelay = Math.min(pollDelay * 2, 15000); } finally { pollInFlight = false; window.setTimeout(poll, pollDelay); } }
    async function newChat() { messages.replaceChildren(); const data = await request("/api/next", {method:"POST", body:JSON.stringify({id:clientId})}); updateState(data); handleEvents(data.events); input.focus(); }
    document.querySelector("#composer").addEventListener("submit", async (event) => { event.preventDefault(); const text = input.value.trim(); if (!text || !isMatched) return; addMessage("вы", text, true); input.value = ""; try { await request("/api/send", {method:"POST", body:JSON.stringify({id:clientId, text})}); } catch (error) { status.textContent = "соединение потеряно"; } });
    document.querySelector("#nextButton").addEventListener("click", () => newChat().catch(() => { status.textContent = "соединение потеряно"; status.className = "status disconnected"; }));
    window.addEventListener("pagehide", () => { if (clientId) navigator.sendBeacon("/api/leave", new Blob([JSON.stringify({id:clientId})], {type:"application/json"})); });
    request("/api/join", {method:"POST", body:"{}"}).then((data) => { clientId = data.clientId; updateState(data); handleEvents(data.events); poll(); }).catch(() => { status.textContent = "сервер недоступен"; status.className = "status disconnected"; });
  </script>
</body>
</html>'''
