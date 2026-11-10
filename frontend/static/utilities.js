import {$, $$, el, icon, settings, on, emit, ask} from './core.js';
import {wm} from './windows.js';
import {fifteenGame,reversiGame} from './arcade.js';

export const calculatorApp={id:'calculator',name:'Калькулятор',subtitle:'Повседневные вычисления',icon:'calc',width:345,height:505,
  mount(win){
    win.body.innerHTML=`<div class="calculator"><div class="calc-expression"></div><div class="calc-display" aria-live="polite">0</div><div class="calc-grid">${[['AC','clear'],['±','sign'],['%','percent'],['÷','/'],['7','7'],['8','8'],['9','9'],['×','*'],['4','4'],['5','5'],['6','6'],['−','-'],['1','1'],['2','2'],['3','3'],['+','+'],['0','0'],['.','.'],['=','=']].map(([label,key])=>`<button data-key="${key}" class="${['/','*','-','+'].includes(key)?'operator':key==='='?'equals':key==='0'?'zero':''}">${label}</button>`).join('')}</div></div>`;
    let current='0',stored=null,operator=null,reset=false,lastValue=null,lastOperator=null;
    const calc=(a,b,op)=>{const value=op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:a/b;if(!Number.isFinite(value))throw new Error('Деление на ноль');return Number(value.toPrecision(12));};
    const display=()=>{$('.calc-display',win.body).textContent=current;$('.calc-expression',win.body).textContent=operator&&stored!=null?`${stored} ${{'/':'÷','*':'×','-':'−','+':'+'}[operator]}`:'';};
    function press(key){
      try{
        if(key==='clear'){current='0';stored=operator=lastValue=lastOperator=null;reset=false;}
        else if(key==='backspace'){current=current.length>1?current.slice(0,-1):'0';}
        else if(key==='sign'){current=String(-Number(current));}
        else if(key==='percent'){current=String(Number(current)/100*(stored!=null&&['+','-'].includes(operator)?stored:1));}
        else if(/[0-9.]/.test(key)&&key.length===1){if(reset||current==='Ошибка'){current='0';reset=false;}if(key==='.'&&current.includes('.'))return;if(current.replace('-','').length>=14)return;current=current==='0'&&key!=='.'?key:current+key;}
        else if(['+','-','*','/'].includes(key)){if(operator&&!reset)current=String(calc(stored,Number(current),operator));stored=Number(current);operator=key;reset=true;}
        else if(key==='='){if(operator){lastValue=Number(current);lastOperator=operator;current=String(calc(stored,lastValue,operator));}else if(lastOperator)current=String(calc(Number(current),lastValue,lastOperator));operator=null;stored=null;reset=true;}
      }catch{current='Ошибка';operator=stored=null;reset=true;}
      display();
    }
    $$('[data-key]',win.body).forEach(b=>b.onclick=()=>press(b.dataset.key));
    document.addEventListener('keydown',e=>{if(wm.active!==win||$('#system-dialog').open)return;const key=e.key==='Enter'?'=':e.key==='Escape'?'clear':e.key==='Backspace'?'backspace':e.key;if(/^[\d.+\-*/=]$/.test(key)||['clear','backspace'].includes(key)){e.preventDefault();press(key);}},{signal:win.abort.signal});
  }
};

export const gamesApp={id:'games',name:'Игры',subtitle:'Аркады и головоломки',keywords:'2048 сапёр змейка реверси пятнашки',icon:'games',width:505,height:625,
  mount(win){
    win.body.innerHTML=`<nav class="game-tabs" aria-label="Игры"><button data-game="2048" class="active">2048</button><button data-game="mines">Сапёр</button><button data-game="snake">Змейка</button><button data-game="reversi">Реверси</button><button data-game="fifteen">Пятнашки</button><button data-game="galaxy" title="Открыть в отдельном окне">Галактика ↗</button></nav><main class="games-content"></main>`;
    let cleanup=()=>{};
    const tabs=$$('[data-game]:not([data-game="galaxy"])',win.body);
    function select(name){cleanup();tabs.forEach(b=>{b.classList.toggle('active',b.dataset.game===name);b.setAttribute('aria-pressed',String(b.dataset.game===name));});const root=$('.games-content',win.body);root.replaceChildren();cleanup=({2048:twoGame,mines:minesGame,snake:snakeGame,reversi:reversiGame,fifteen:fifteenGame}[name])(root,win);}
    tabs.forEach(b=>b.onclick=()=>select(b.dataset.game));
    $('[data-game="galaxy"]',win.body).onclick=()=>wm.open('galaxy');
    select('2048');return()=>cleanup();
  }
};
function swipe(element,callback,signal){let x,y;element.addEventListener('pointerdown',e=>{x=e.clientX;y=e.clientY;element.setPointerCapture(e.pointerId);},{signal});element.addEventListener('pointerup',e=>{const dx=e.clientX-x,dy=e.clientY-y;if(Math.max(Math.abs(dx),Math.abs(dy))>22)callback(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');},{signal});}
function keyControl(win,callback,signal){document.addEventListener('keydown',e=>{if(wm.active!==win||win.minimized||$('#system-dialog').open||e.target.closest('input,textarea'))return;const direction={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',a:'left',s:'down',d:'right'}[e.key];if(direction){e.preventDefault();callback(direction);}},{signal});}
function twoGame(root,win){
  const controller=new AbortController(),signal=controller.signal;
  root.innerHTML=`<div class="game-top"><h2>2048</h2><small>Счёт: <b class="score">0</b></small><button class="reset">Заново</button></div><div class="two-board" aria-label="Поле 2048"></div><p class="game-help game-status">Соберите плитку 2048.<br>Стрелки, WASD или свайп.</p>`;
  let tiles=Array(16).fill(0),score=0,over=false;
  const spawn=()=>{const empty=tiles.map((v,i)=>v===0?i:-1).filter(i=>i>=0);if(empty.length)tiles[empty[Math.floor(Math.random()*empty.length)]]=Math.random()<.9?2:4;};
  const render=()=>{const board=$('.two-board',root);board.replaceChildren(...tiles.map(v=>el('div',{class:`two-cell ${v>=128?'large':''}`,'data-value':v},v?String(v):'')));$('.score',root).textContent=String(score);};
  function move(dir){if(over)return;const old=tiles.join(',');const next=Array(16).fill(0);const reverse=['right','down'].includes(dir),horizontal=['left','right'].includes(dir);
    for(let i=0;i<4;i++){
      const indices=Array.from({length:4},(_,j)=>horizontal?i*4+j:j*4+i);if(reverse)indices.reverse();let values=indices.map(j=>tiles[j]).filter(Boolean),out=[];
      for(let j=0;j<values.length;j++){if(values[j]===values[j+1]){out.push(values[j]*2);score+=values[j]*2;j++;}else out.push(values[j]);}while(out.length<4)out.push(0);indices.forEach((index,j)=>next[index]=out[j]);
    }
    tiles=next;if(tiles.join(',')===old)return;spawn();
    const canMove=tiles.includes(0)||tiles.some((v,i)=>(i%4<3&&v===tiles[i+1])||(i<12&&v===tiles[i+4]));
    over=!canMove;if(tiles.includes(2048))$('.game-status',root).textContent='2048! Продолжайте собирать новые плитки.';if(over)$('.game-status',root).textContent='Ходов больше нет. Начните новую игру.';render();
  }
  const reset=()=>{tiles=Array(16).fill(0);score=0;over=false;spawn();spawn();render();$('.game-status',root).textContent='Стрелки, WASD или свайп.';};
  $('.reset',root).onclick=reset;keyControl(win,move,signal);swipe($('.two-board',root),move,signal);reset();return()=>controller.abort();
}
function minesGame(root){
  root.innerHTML=`<div class="game-top"><h2>Сапёр</h2><small class="mine-count">10 мин</small><button class="reset">Заново</button></div><div class="mine-board" aria-label="Поле сапёра"></div><p class="game-help mine-status">Первый ход безопасен.<br>Клик — открыть. ПКМ или режим флага — поставить флаг.</p><label class="game-help row"><input class="flag-mode" type="checkbox">Режим флага для сенсорного экрана</label>`;
  let cells=[],started=false,over=false;
  const neighbors=index=>{const x=index%8,y=Math.floor(index/8),out=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if((dx||dy)&&x+dx>=0&&x+dx<8&&y+dy>=0&&y+dy<8)out.push((y+dy)*8+x+dx);}return out;};
  function render(){const board=$('.mine-board',root);board.replaceChildren();for(let i=0;i<64;i++){const c=cells[i],b=el('button',{class:c.open?'open':'','data-count':c.count||0,'aria-label':`Клетка ${i+1}${c.flag?' флаг':''}`},c.open?(c.bomb?'✹':c.count?String(c.count):''):c.flag?'⚑':'');b.onclick=()=>$('.flag-mode',root).checked?flag(i):open(i);b.oncontextmenu=e=>{e.preventDefault();flag(i);};board.append(b);}$('.mine-count',root).textContent=`${10-cells.filter(c=>c.flag).length} мин`;}
  function plant(safe){const excluded=new Set([safe,...neighbors(safe)]);const eligible=cells.map((_,i)=>i).filter(i=>!excluded.has(i));for(let i=0;i<10;i++){const k=Math.floor(Math.random()*eligible.length);cells[eligible.splice(k,1)[0]].bomb=true;}cells.forEach((c,i)=>c.count=neighbors(i).filter(j=>cells[j].bomb).length);started=true;}
  function flag(i){if(over||cells[i].open)return;cells[i].flag=!cells[i].flag;render();}
  function open(i){if(over||cells[i].open||cells[i].flag)return;if(!started)plant(i);if(cells[i].bomb){over=true;cells.forEach(c=>{if(c.bomb)c.open=true;});$('.mine-status',root).textContent='Мина! Попробуйте ещё раз.';render();return;}
    const queue=[i],seen=new Set();while(queue.length){const j=queue.pop();if(seen.has(j)||cells[j].flag||cells[j].bomb)continue;seen.add(j);cells[j].open=true;if(!cells[j].count)queue.push(...neighbors(j));}
    if(cells.filter(c=>c.open&&!c.bomb).length===54){over=true;$('.mine-status',root).textContent='Поле очищено. Вы победили!';}render();}
  const reset=()=>{cells=Array.from({length:64},()=>({bomb:false,flag:false,open:false,count:0}));started=over=false;$('.mine-status',root).textContent='Первый ход безопасен. ПКМ или режим флага — поставить флаг.';render();};$('.reset',root).onclick=reset;reset();return()=>{};
}
function snakeGame(root,win){
  const controller=new AbortController();
  root.innerHTML=`<div class="game-top"><h2>Змейка</h2><small>Счёт: <b class="score">0</b></small><button class="reset">Начать</button></div><canvas class="snake-canvas" width="360" height="360"></canvas><p class="game-help snake-status">Нажмите «Начать». Стрелки, WASD или свайп.<br>Игра приостанавливается, когда окно не активно.</p><div class="dpad">${[['left','←'],['up','↑'],['down','↓'],['right','→']].map(([d,label])=>`<button data-dir="${d}" aria-label="${d}">${label}</button>`).join('')}</div>`;
  const canvas=$('canvas',root),ctx=canvas.getContext('2d');let snake=[{x:8,y:9}],food={x:4,y:5},direction={x:1,y:0},pending=direction,score=0,playing=false,changed=false;
  const vectors={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
  const draw=()=>{ctx.fillStyle='#14241a';ctx.fillRect(0,0,360,360);ctx.strokeStyle='#ffffff06';for(let i=0;i<18;i++){ctx.beginPath();ctx.moveTo(i*20,0);ctx.lineTo(i*20,360);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i*20);ctx.lineTo(360,i*20);ctx.stroke();}ctx.fillStyle='#d9b775';ctx.fillRect(food.x*20+4,food.y*20+4,12,12);snake.forEach((p,i)=>{ctx.fillStyle=i?'#629859':'#b0df95';ctx.fillRect(p.x*20+2,p.y*20+2,16,16);});};
  const move=dir=>{const v=vectors[dir];if(changed||v.x===-direction.x&&v.y===-direction.y)return;pending=v;changed=true;};
  function tick(){if(!playing||wm.active!==win||win.minimized||win.workspace!==wm.workspace||!$('#lock-screen').hidden)return;direction=pending;changed=false;const head={x:snake[0].x+direction.x,y:snake[0].y+direction.y};const eat=head.x===food.x&&head.y===food.y;const body=eat?snake:snake.slice(0,-1);if(head.x<0||head.x>=18||head.y<0||head.y>=18||body.some(p=>p.x===head.x&&p.y===head.y)){playing=false;$('.snake-status',root).textContent='Игра окончена. Начните заново.';return;}snake.unshift(head);if(eat){score++;$('.score',root).textContent=String(score);if(snake.length===324){playing=false;$('.snake-status',root).textContent='Всё поле ваше. Победа!';return;}do{food={x:Math.floor(Math.random()*18),y:Math.floor(Math.random()*18)};}while(snake.some(p=>p.x===food.x&&p.y===food.y));}else snake.pop();draw();}
  $('.reset',root).onclick=()=>{snake=[{x:8,y:9}];food={x:4,y:5};direction=pending={x:1,y:0};changed=false;score=0;playing=true;$('.score',root).textContent='0';$('.snake-status',root).textContent='Собирайте еду и избегайте стен.';$('.reset',root).textContent='Заново';draw();};
  $$('[data-dir]',root).forEach(b=>b.onclick=()=>move(b.dataset.dir));keyControl(win,move,controller.signal);swipe(canvas,move,controller.signal);draw();const timer=setInterval(tick,135);return()=>{clearInterval(timer);controller.abort();};
}

export const chatApp={id:'chat',name:'Text Roulette',subtitle:'Анонимный текстовый чат',icon:'chat',singleton:true,width:710,height:570,
  mount(win){
    win.body.innerHTML=`<div class="chat-app"><div class="chat-banner">${icon('chat')}<div class="grow"><strong>Text Roulette</strong><small class="chat-status">Подключение к серверу…</small></div><button class="next-chat">Новый чат ↗</button></div><div class="chat-messages" aria-live="polite"><div class="chat-empty">${icon('chat')}Ищем собеседника…</div></div><form class="chat-composer"><input class="chat-input" maxlength="500" placeholder="Напишите сообщение…" aria-label="Сообщение" disabled><button class="primary" disabled>Отправить</button></form></div>`;
    const q=s=>$(s,win.body);let clientId='',matched=false,disposed=false,timer,delay=1000,inFlight=false;
    const request=async(path,body)=>{const response=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.any([win.abort.signal,AbortSignal.timeout(15000)])});if(!response.ok)throw new Error(String(response.status));return response.json();};
    function add(author,text,mine=false){q('.chat-empty')?.remove();const article=el('article',{class:`chat-message ${mine?'mine':''}`},el('small',{},`${author} · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`),el('p',{},text));q('.chat-messages').append(article);q('.chat-messages').scrollTop=q('.chat-messages').scrollHeight;}
    function update(data){matched=data.state==='matched';q('.chat-status').textContent=matched?`В сети: ${data.partner}`:'Ожидание собеседника…';q('.chat-input').disabled=q('.chat-composer button').disabled=!matched;for(const event of data.events||[]){if(event.type==='message')add(event.from,event.text);if(event.type==='left')add('Система','Собеседник покинул чат. Нажмите «Новый чат».');}}
    async function join(){const data=await request('/api/join',{});if(disposed)return;clientId=data.clientId;update(data);}
    async function poll(){if(disposed)return;try{if(!clientId)await join();else update(await request(`/api/poll?id=${encodeURIComponent(clientId)}`));delay=1000;}catch(e){if(disposed)return;if(e.message==='404')clientId='';q('.chat-status').textContent='Нет связи с сервером. Повторное подключение…';delay=Math.min(delay*2,10000);matched=false;q('.chat-input').disabled=q('.chat-composer button').disabled=true;}finally{if(!disposed)timer=setTimeout(poll,delay);}}
    q('.chat-composer').onsubmit=async e=>{e.preventDefault();const text=q('.chat-input').value.trim();if(!matched||!text||inFlight)return;inFlight=true;q('.chat-composer button').disabled=true;try{await request('/api/send',{id:clientId,text});if(disposed)return;add('Вы',text,true);q('.chat-input').value='';}catch{q('.chat-status').textContent='Сообщение не отправлено. Проверьте соединение.';}finally{inFlight=false;if(!disposed)q('.chat-composer button').disabled=!matched;}};
    q('.next-chat').onclick=async()=>{if(!clientId||inFlight)return;inFlight=true;try{update(await request('/api/next',{id:clientId}));q('.chat-messages').replaceChildren(el('div',{class:'chat-empty'},'Поиск нового собеседника…'));}catch{q('.chat-status').textContent='Не удалось сменить чат.';}finally{inFlight=false;}};
    const leave=()=>{if(clientId){navigator.sendBeacon('/api/leave',new Blob([JSON.stringify({id:clientId})],{type:'application/json'}));clientId='';}};
    window.addEventListener('pagehide',leave,{signal:win.abort.signal});poll();return()=>{disposed=true;clearTimeout(timer);leave();};
  }
};
