import {$, $$, el, icon, settings, on, emit, ask, pickFile, download, bytes} from './core.js';
import {fs, state} from './storage.js';
import {wm} from './windows.js';

export const linux = {vm:null, profile:null, ready:false, ram:0, status:'Выключена'};
let library;
function loadLibrary() {
  if(globalThis.V86)return Promise.resolve();
  if(!library)library=new Promise((resolve,reject)=>{const script=el('script',{src:'/assets/vendor/v86/libv86.js'});script.onload=resolve;script.onerror=()=>{library=null;script.remove();reject(new Error('Не удалось загрузить эмулятор. Обновите страницу.'));};document.head.append(script);});
  return library;
}
export const profiles = {
  buildroot:{name:'Buildroot Linux 6.8',description:'Linux 6.8 · BusyBox · vi · Lua',image:'buildroot-linux.bin',kind:'bzimage',size:'10 МБ',ram:128,view:'serial'},
  tinycore:{name:'Tiny Core Linux 11',description:'Графический Linux · FLWM · приложения',image:'tinycore.iso',kind:'hda',size:'19 МБ',ram:256,view:'vga'},
  custom:{name:'Свой ISO / диск',description:'32-битный x86 · ISO или IMG',kind:'cdrom',ram:256,view:'vga'},
};
export async function sendToLinux(node) {
  if(!linux.vm||!linux.ready)throw new Error('Сначала запустите Buildroot Linux.');
  if(linux.profile!=='buildroot')throw new Error('Обмен 9p настроен для Buildroot. Для других образов смонтируйте host9p вручную.');
  await linux.vm.create_file(node.name,node.data);
  emit('toast',{message:`${node.name} → Linux /mnt/${node.name}`});
}
export async function receiveFromLinux(path) {
  if(!linux.vm||!linux.ready)throw new Error('Linux ещё не запущена.');
  const relative=path.replace(/^\/mnt\//,'').replace(/^\//,'');
  if(!relative||relative.split('/').some(p=>p==='..'))throw new Error('Укажите файл внутри /mnt.');
  const data=await linux.vm.read_file(relative);
  if(!data)throw new Error('Файл не найден в общей файловой системе 9p.');
  const name=relative.split('/').pop();const existing=fs.list('shared').find(n=>n.name===name);
  await fs.write('shared',name,data,'text/plain',existing?.id);
  emit('toast',{message:`${name} сохранён в «Обмен с Linux»`});
}
async function pack(data) {
  const blob=new Blob([data]);
  if(typeof CompressionStream==='undefined')return {blob,compressed:false};
  return {blob:await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob(),compressed:true};
}
async function unpack(snapshot) {
  if(snapshot.compressed){if(typeof DecompressionStream==='undefined')throw new Error('Этот браузер не поддерживает распаковку снимков.');return new Response(snapshot.blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
  return snapshot.blob.arrayBuffer();
}
async function exportSnapshot(snap) {
  const metadata={...snap,blob:undefined,customImage:undefined};
  const header=new TextEncoder().encode(JSON.stringify(metadata));const len=new Uint32Array([header.length]);
  const image=snap.customImage||new Blob();
  // Envelope lengths make the VM state and optional custom disk independently recoverable.
  download(`greenos-${snap.profile}-${new Date(snap.created).toISOString().slice(0,10)}.gvm`,new Blob(['GREENOS2',len,header,new Uint32Array([snap.blob.size]),snap.blob,image]));
}
async function importSnapshot(file) {
  const prefix=await file.slice(0,12).arrayBuffer();
  if(new TextDecoder().decode(prefix.slice(0,8))!=='GREENOS2')throw new Error('Это не снимок GreenOS 2.');
  const length=new DataView(prefix).getUint32(8,true);
  if(length>1024*1024||length<2||12+length+4>file.size)throw new Error('Повреждён заголовок снимка.');
  const meta=JSON.parse(await file.slice(12,12+length).text());
  if(!profiles[meta.profile]||![128,256,512].includes(meta.ram)||meta.format!==2)throw new Error('Неподдерживаемая конфигурация снимка.');
  const offset=16+length;const size=new DataView(await file.slice(12+length,offset).arrayBuffer()).getUint32(0,true);
  if(offset+size>file.size||!size)throw new Error('Снимок обрезан.');
  return {...meta,blob:file.slice(offset,offset+size),customImage:meta.profile==='custom'?file.slice(offset+size):undefined};
}

export const linuxApp={id:'linux',name:'Linux',subtitle:'Настоящая система x86',icon:'linux',singleton:true,width:1050,height:670,
  async mount(win,options={}) {
    win.body.innerHTML=`<div class="toolbar vm-toolbar"><select class="profile-select" aria-label="Дистрибутив">${Object.entries(profiles).map(([id,p])=>`<option value="${id}">${p.name}</option>`).join('')}</select><select class="ram-select" aria-label="Оперативная память"><option value="128">128 МБ RAM</option><option value="256">256 МБ RAM</option><option value="512">512 МБ RAM</option></select><button class="vm-power primary" title="Запуск или пауза">${icon('play')}<span>Запустить</span></button><div class="secondary-controls"><button class="vm-save" disabled title="Сохранить снимок в браузере">${icon('save')}<span>Снимок</span></button><button class="vm-restore" title="Восстановить снимок">${icon('refresh')}<span>Восстановить</span></button><button class="vm-options" title="Сеть и образ">${icon('settings')}</button><button class="vm-help-toggle" title="Справка">${icon('info')}</button></div></div>
    <div class="vm-network" hidden><span>Сеть</span><select class="network-mode" aria-label="Сетевая карта"><option value="fetch">HTTP через браузер</option><option value="relay">WebSocket relay</option><option value="none">Без сети</option></select><input class="relay-url" placeholder="wss://ваш-relay/" aria-label="Адрес relay" hidden><button class="vm-custom-image">Выбрать ISO / IMG</button><span class="vm-file-hint"></span></div>
    <div class="vm-tabs"><button data-view="serial" class="active">Консоль Linux</button><button data-view="vga">Экран компьютера</button><span class="spacer"></span><button class="vm-export" title="Скачать последний снимок">Экспорт</button><button class="vm-import" title="Загрузить снимок .gvm">Импорт</button></div>
    <div class="vm-viewport"><div class="vm-progress" hidden><div></div></div><div class="serial-terminal"></div><div class="vga-screen" tabindex="0" aria-label="Экран виртуального компьютера" hidden><div></div><canvas hidden></canvas></div><div class="vm-start-screen">${icon('linux')}<span class="badge green">X86 · WEBASSEMBLY</span><h2>Linux, который работает.</h2><p>Настоящее ядро, настоящие команды и программы. Вся виртуальная машина — внутри этой вкладки.</p><button class="primary vm-start">Запустить Linux ${icon('arrow')}</button><small class="vm-image-info"></small></div><aside class="vm-help" hidden><h3>Ваш компьютер в браузере</h3><p><b>Buildroot</b> загружается за несколько секунд. Это Linux 6.8 с BusyBox, vi и Lua; пакетного менеджера нет.</p><code>uname -a\nls /bin\nvi hello.txt\nlua -v</code><p><b>Общие файлы</b> доступны в <code>/mnt</code>Отправляйте и забирайте их из файлового менеджера. Изменения в RAM Linux сохраняются в снимок.</p><p><b>Tiny Core</b> — графический Linux. Выберите «Экран компьютера», нажмите на него для ввода. Enter запускает выбранный пункт загрузчика.</p><p><b>Свой образ:</b> выберите 32-битный x86 ISO или IMG. 64-битные образы не поддерживаются.</p><p><b>Сеть:</b> HTTP через браузер ограничен CORS. Полная сеть требует совместимого WebSocket relay. Смените сеть до запуска.</p><p>Снимки совместимы с этой версией эмулятора. Закрытие вкладки без снимка теряет изменения Linux.</p><a href="https://github.com/copy/v86" target="_blank" rel="noreferrer">v86 · исходный код ↗</a></aside></div>
    <footer class="statusbar vm-statusbar"><span class="vm-status-dot"></span><span class="vm-status">Выключена</span><span class="spacer"></span><span class="vm-save-time">Нет сохранённого снимка</span><span>v86 / x86</span></footer>`;
    const q=s=>$(s,win.body),profileSelect=q('.profile-select'),ramSelect=q('.ram-select'),power=q('.vm-power'),overlay=q('.vm-start-screen');
    // v86 controls visibility with inline display styles; the HTML hidden attribute
    // would keep its framebuffer invisible even after switching to graphics mode.
    q('.vga-screen canvas').removeAttribute('hidden');q('.vga-screen canvas').style.display='none';
    const term=new globalThis.Terminal({cursorBlink:true,fontSize:13,fontFamily:'Cascadia Code, Consolas, monospace',scrollback:5000,convertEol:false,theme:{background:'#101713',foreground:'#dbe7d4',cursor:'#a5d890',selectionBackground:'#a5d89044',black:'#101713',green:'#a5d890',brightGreen:'#bbefa5'}});
    const fit=new globalThis.FitAddon.FitAddon();term.loadAddon(fit);term.open(q('.serial-terminal'));fit.fit();
    let view='serial',customImage,customName='',machineConfig,disposed=false,busy=false,checkpoint,lastOutput='',shellInitialized=false,bootTimeout,startedAt=0;
    const runtime=await fetch('/assets/runtime-lock.json').then(r=>r.json());const runtimeId=runtime['vendor/v86/libv86.js'].sha256;
    const updateStatus=text=>{linux.status=text;q('.vm-status').textContent=text;q('.vm-status-dot').classList.toggle('running',!!linux.vm?.is_running());emit('linux',linux);};
    const setView=name=>{view=name;q('.serial-terminal').hidden=name!=='serial';q('.vga-screen').hidden=name!=='vga';$$('[data-view]',win.body).forEach(b=>b.classList.toggle('active',b.dataset.view===name));if(name==='serial'){requestAnimationFrame(()=>fit.fit());}syncKeyboard();};
    const syncKeyboard=()=>{const enabled=!disposed&&wm.active===win&&!win.minimized&&win.workspace===wm.workspace&&view==='vga'&&q('.vga-screen').contains(document.activeElement)&&$('#lock-screen').hidden;linux.vm?.keyboard_set_enabled(enabled);linux.vm?.mouse_set_enabled(enabled);};
    const showProfile=async()=>{
      const id=profileSelect.value,p=profiles[id];settings.set({profile:id});q('.vm-image-info').textContent=`${p.description} · ${p.size||'локальный файл'}`;
      checkpoint=await state.get(`vm-checkpoint-${id}`);if(disposed)return;
      q('.vm-save-time').textContent=checkpoint?`Снимок: ${new Date(checkpoint.created).toLocaleString('ru-RU')}`:'Нет сохранённого снимка';
      q('.vm-export').disabled=!checkpoint;
    };
    profileSelect.value=profiles[options.profile||settings.get('profile')]?options.profile||settings.get('profile'):'buildroot';
    ramSelect.value=String(options.profile==='tinycore'?256:settings.get('ram'));
    await showProfile();setView(profiles[profileSelect.value].view);
    profileSelect.onchange=()=>{ramSelect.value=String(profiles[profileSelect.value].ram);showProfile();setView(profiles[profileSelect.value].view);};
    q('.vm-help-toggle').onclick=()=>q('.vm-help').hidden=!q('.vm-help').hidden;
    q('.vm-options').onclick=()=>q('.vm-network').hidden=!q('.vm-network').hidden;
    q('.network-mode').onchange=()=>q('.relay-url').hidden=q('.network-mode').value!=='relay';
    $$('[data-view]',win.body).forEach(b=>b.onclick=()=>setView(b.dataset.view));
    q('.vga-screen').addEventListener('pointerdown',()=>{q('.vga-screen').focus();syncKeyboard();});
    document.addEventListener('focusin',syncKeyboard,{signal:win.abort.signal});on('focus',syncKeyboard,win.abort.signal);on('lock',syncKeyboard,win.abort.signal);
    const observer=new ResizeObserver(()=>{if(view==='serial'&&!win.minimized)try{fit.fit();}catch{}});observer.observe(q('.serial-terminal'));
    term.onData(data=>{if(linux.vm?.is_running())linux.vm.serial_send_bytes(0,new TextEncoder().encode(data));});
    q('.vm-custom-image').onclick=async()=>{const [file]=await pickFile('.iso,.img,.bin');if(!file)return;if(file.size>512*1024*1024){emit('toast',{message:'Образ должен быть не больше 512 МБ.',error:true});return;}customImage=file;customName=file.name;profileSelect.value='custom';ramSelect.value='256';q('.vm-file-hint').textContent=file.name;await showProfile();setView('vga');};
    async function start(snap) {
      if(busy||disposed)return;
      busy=true;
      try {
        const profile=snap?.profile||profileSelect.value,ram=snap?.ram||Number(ramSelect.value),p=profiles[profile];
        if(snap&&snap.runtime!==runtimeId)throw new Error('Снимок создан другой версией v86. Используйте исходную версию эмулятора.');
        if(linux.vm){const yes=await ask('Перезапустить Linux?',{message:'Текущее состояние будет заменено. Сначала сохраните снимок, если оно нужно.',confirm:true,ok:'Перезапустить'});if(!yes)return;await linux.vm.destroy();linux.vm=null;}
        let image=snap?.customImage||customImage;
        if(profile==='custom'&&!image){const [file]=await pickFile('.iso,.img,.bin');if(!file)return;image=customImage=file;customName=file.name;}
        if(profile==='custom'&&(!image.size||image.size>512*1024*1024))throw new Error('Образ должен быть от 1 байта до 512 МБ.');
        const network=snap?.network||q('.network-mode').value,relay=snap?.relay||q('.relay-url').value.trim();
        if(network==='relay'&&!/^wss?:\/\//.test(relay))throw new Error('Укажите ws:// или wss:// адрес совместимого relay.');
        updateStatus('Подготовка эмулятора…');await loadLibrary();if(disposed)return;
        overlay.hidden=true;term.reset();shellInitialized=!!snap;lastOutput='';linux.ready=false;linux.profile=profile;linux.ram=ram;
        profileSelect.value=profile;ramSelect.value=String(ram);setView(p.view);
        const config={wasm_path:'/assets/vendor/v86/v86.wasm',memory_size:ram*1024*1024,vga_memory_size:8*1024*1024,bios:{url:'/assets/vendor/v86/seabios.bin'},vga_bios:{url:'/assets/vendor/v86/vgabios.bin'},screen_container:q('.vga-screen'),filesystem:{},autostart:false,disable_speaker:true,disable_keyboard:false,disable_mouse:false,preserve_mac_from_state_image:true};
        config[profile==='custom'?(customName.toLowerCase().endsWith('.img')?'hda':snap?.diskKind||'cdrom'):p.kind]=profile==='custom'?{buffer:await image.arrayBuffer()}:{url:`/assets/images/${p.image}`};
        if(profile==='buildroot')config.cmdline='console=ttyS0,115200 tsc=reliable mitigations=off random.trust_cpu=on';
        if(network!=='none')config.net_device={type:profile==='buildroot'?'virtio':'ne2k',relay_url:network==='fetch'?'fetch':relay};
        machineConfig={format:2,runtime:runtimeId,profile,ram,network,relay,customImage:profile==='custom'?image:undefined,diskKind:profile==='custom'?Object.keys(config).find(k=>['hda','cdrom'].includes(k)):undefined,customName};
        linux.vm=new globalThis.V86(config);const vm=linux.vm;startedAt=Date.now();updateStatus('Загрузка Linux…');
        settings.set({ram,profile});
        q('.vm-progress').hidden=false;
        bootTimeout=setTimeout(()=>{if(!disposed&&!linux.ready)updateStatus('Загрузка продолжается. Проверьте экран компьютера.');},60000);
        vm.add_listener('download-progress',e=>{q('.vm-progress div').style.width=`${e.total?Math.round(e.loaded/e.total*100):15}%`;updateStatus(`Загрузка ${e.file_name.split('/').pop()}${e.total?` · ${Math.round(e.loaded/e.total*100)}%`:''}`);});
        vm.add_listener('download-error',()=>{updateStatus('Ошибка загрузки образа. Закройте и снова откройте Linux.');q('.vm-progress').hidden=true;emit('toast',{message:'Не удалось загрузить образ Linux.',error:true});});
        vm.add_listener('screen-set-size',data=>{if(data[2]&&profile==='tinycore')updateStatus('Графический экран · Tiny Core Linux');});
        const buffer=[];let scheduled=false;
        vm.add_listener('serial0-output-byte',byte=>{
          buffer.push(byte);if(!scheduled){scheduled=true;requestAnimationFrame(()=>{if(!disposed)term.write(new Uint8Array(buffer.splice(0)));scheduled=false;});}
          lastOutput=(lastOutput+String.fromCharCode(byte)).slice(-400);
          if(profile==='buildroot'&&!shellInitialized&&/~\s*[%#$] $/.test(lastOutput)){
            shellInitialized=true;linux.ready=true;clearTimeout(bootTimeout);q('.vm-progress').hidden=true;updateStatus('Linux работает · /mnt — общие файлы');
            vm.serial0_send("export TERM=xterm; printf '\\033[2J\\033[H\\033[1;32mGreenOS / Linux 6.8\\033[0m\\nShared files: /mnt  |  Programs: ls /bin\\n\\n'\n");
            for(const node of fs.list('shared').filter(n=>n.type==='file'))vm.create_file(node.name,node.data).catch(console.error);
          }
        });
        vm.add_listener('emulator-ready',async()=>{
          if(disposed)return;
          vm.keyboard_set_enabled(false);vm.mouse_set_enabled(false);
          try{if(snap){await vm.restore_state(await unpack(snap));linux.ready=true;q('.vm-progress').hidden=true;term.write('\r\n\x1b[32mСостояние Linux восстановлено. Нажмите Enter для приглашения оболочки.\x1b[0m\r\n');}
          await vm.run();q('.vm-save').disabled=false;power.innerHTML=`${icon('pause')}<span>Пауза</span>`;
          if(profile!=='buildroot'||snap){linux.ready=true;clearTimeout(bootTimeout);q('.vm-progress').hidden=true;updateStatus(snap?'Снимок восстановлен':'Linux работает · загрузка гостевой системы');}
          if(profile==='tinycore'&&!snap){vm.wait_until_vga_screen_contains(/Press ENTER to boot/,{timeout_msec:20000}).then(found=>{if(found&&!disposed&&linux.vm===vm)vm.keyboard_send_scancodes([0x1c,0x9c]);}).catch(console.warn);}
          if(view==='serial')term.focus();syncKeyboard();}catch(e){updateStatus(`Ошибка: ${e.message}`);emit('toast',{message:e.message,error:true});}
        });
        emit('linux',linux);
      }catch(e){updateStatus(e.message);emit('toast',{message:e.message,error:true});}
      finally{busy=false;}
    }
    const pause=async()=>{if(!linux.vm)return;const running=linux.vm.is_running();if(running)await linux.vm.stop();else await linux.vm.run();power.innerHTML=`${icon(running?'play':'pause')}<span>${running?'Продолжить':'Пауза'}</span>`;updateStatus(running?'Приостановлена':'Linux работает');emit('linux',linux);};
    const reboot=el('button',{title:'Перезапустить с выбранным дистрибутивом и объёмом RAM','aria-label':'Перезапустить Linux'});reboot.innerHTML=icon('refresh');reboot.onclick=()=>start();power.after(reboot);
    q('.vm-start').onclick=()=>start();power.onclick=()=>linux.vm?pause():start();
    q('.vm-save').onclick=async()=>{
      if(!linux.vm||busy)return;busy=true;q('.vm-save').disabled=true;const running=linux.vm.is_running();
      try{updateStatus('Сохранение снимка…');await linux.vm.stop();const packed=await pack(await linux.vm.save_state());checkpoint={...machineConfig,...packed,created:Date.now()};await state.set(`vm-checkpoint-${linux.profile}`,checkpoint);q('.vm-save-time').textContent=`Снимок: ${new Date(checkpoint.created).toLocaleTimeString('ru-RU')}`;q('.vm-export').disabled=false;emit('toast',{message:`Снимок Linux сохранён · ${bytes(packed.blob.size)}`});}
      catch(e){emit('toast',{message:`Не удалось сохранить снимок: ${e.message}`,error:true});}
      finally{if(running)await linux.vm.run();busy=false;q('.vm-save').disabled=false;updateStatus(running?'Linux работает':'Приостановлена');}
    };
    q('.vm-restore').onclick=async()=>{const snap=await state.get(`vm-checkpoint-${profileSelect.value}`);if(!snap){emit('toast',{message:'Сначала сохраните снимок или импортируйте .gvm файл.'});return;}await start(snap);};
    q('.vm-export').onclick=()=>checkpoint&&exportSnapshot(checkpoint);
    q('.vm-import').onclick=async()=>{try{const [file]=await pickFile('.gvm');if(!file)return;if(file.size>700*1024*1024)throw new Error('Слишком большой снимок.');const snap=await importSnapshot(file);await start(snap);}catch(e){emit('toast',{message:e.message,error:true});}};
    win.activate=async requested=>{if(requested.profile&&profiles[requested.profile]){profileSelect.value=requested.profile;ramSelect.value=String(profiles[requested.profile].ram);await showProfile();setView(profiles[requested.profile].view);if(requested.autostart&&requested.profile!==linux.profile)await start();}else if(requested.autostart&&!linux.vm)await start();};
    win.beforeClose=async()=>busy?false:!linux.vm||!!await ask('Закрыть виртуальную машину?',{message:'Linux остановится. Изменения после последнего снимка будут потеряны. Сохраните снимок перед закрытием.',confirm:true,ok:'Закрыть Linux'});
    win.serialize=()=>({profile:profileSelect.value});
    if(options.autostart)start(options.restore?checkpoint:undefined);
    return async()=>{disposed=true;clearTimeout(bootTimeout);observer.disconnect();term.dispose();if(linux.vm)await linux.vm.destroy();linux.vm=null;linux.ready=false;linux.status='Выключена';emit('linux',linux);};
  }
};
