import {ask,bytes,download,el,emit,icon,on,pickFile} from './core.js';
import {linux} from './linux.js';
import {listOfficeDrafts,removeOfficeDraft} from './recovery-store.js';
import {createWorkspaceBackup,inspectWorkspaceBackup,restoreWorkspaceBackup,WORKSPACE_BACKUP_EXTENSION} from './workspace-backup.js';
import {wm} from './windows.js';

const dateFormat=new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'});
const editorNames={docx:'Word',xlsx:'Excel',pptx:'PowerPoint'};
const draftWindow=id=>wm.windows.find(win=>win.officeDraftId===id || win.options.draftId===id);

function requireIdleWorkspace() {
  if (linux.vm) throw new Error('Сохраните нужный снимок и выключите Linux перед восстановлением.');
  if (wm.windows.some(win=>win.isOfficeBusy?.())) throw new Error('Дождитесь завершения операции в Документах.');
  if (wm.windows.some(win=>win.hasUnsavedChanges?.() || (win.app.id==='editor' && win.serialize?.().draft!=null))) {
    throw new Error('Сохраните или закройте окна с несохранёнными правками перед восстановлением.');
  }
}

export const recoveryApp={
  id:'recovery',name:'Центр восстановления',subtitle:'Черновики Office и резервные копии',
  keywords:'восстановление бэкап backup перенос копия данные черновики',
  icon:'refresh',singleton:true,width:690,height:590,
  mount(win) {
    const draftList=el('div',{class:'recovery-drafts'});
    const includeLinux=el('input',{type:'checkbox'});
    const exportButton=el('button',{type:'button',class:'primary'},'Скачать резервную копию');
    const importButton=el('button',{type:'button'},'Восстановить из копии…');
    const status=el('p',{class:'recovery-status',role:'status',hidden:true});
    const {signal}=win.abort;
    let busy=false, revision=0;

    function showStatus(message='',error=false) {
      status.textContent=message;
      status.hidden=!message;
      status.classList.toggle('error',error);
    }

    function run(action) {
      return async()=>{
        if (busy || signal.aborted) return;
        busy=true;
        includeLinux.disabled=exportButton.disabled=importButton.disabled=draftList.inert=true;
        showStatus();
        try { await action(); }
        catch(error) { if (!signal.aborted) showStatus(error.message,true); }
        finally {
          busy=false;
          includeLinux.disabled=exportButton.disabled=importButton.disabled=draftList.inert=false;
        }
      };
    }
    win.beforeClose=()=>!busy;

    async function renderDrafts() {
      const current=++revision;
      let drafts;
      try { drafts=await listOfficeDrafts(); }
      catch(error) {
        if (!signal.aborted && current===revision) draftList.textContent=error.message;
        return;
      }
      if (signal.aborted || current!==revision) return;
      if (!drafts.length) {
        draftList.replaceChildren(el('p',{class:'recovery-empty'},'Сохранённых черновиков пока нет.'));
        return;
      }
      draftList.replaceChildren(...drafts.map(meta=>{
        const restore=el('button',{type:'button'},draftWindow(meta.id)?'Перейти к документу':'Восстановить');
        restore.onclick=run(async()=>{
          const existing=draftWindow(meta.id);
          if (existing) wm.restore(existing);
          else await wm.open('office',{draftId:meta.id});
        });
        const remove=el('button',{type:'button',disabled:Boolean(draftWindow(meta.id))},'Удалить черновик');
        remove.onclick=run(async()=>{
          if (!await ask('Удалить черновик?',{confirm:true,ok:'Удалить',message:meta.name})) return;
          if (draftWindow(meta.id) || !await removeOfficeDraft(meta)) {
            throw new Error('Черновик изменился. Проверьте его перед удалением.');
          }
          await renderDrafts();
        });
        return el('article',{class:'recovery-draft','data-draft-id':meta.id},
          el('div',{class:'recovery-draft-description'},el('strong',{},meta.name),
            el('small',{},editorNames[meta.kind]+' · '+dateFormat.format(meta.updated))),
          el('div',{class:'recovery-actions'},restore,remove));
      }));
    }

    exportButton.onclick=run(async()=>{
      showStatus('Подготавливаем резервную копию…');
      await Promise.all(wm.windows.map(window=>window.flushOfficeDraft?.()));
      const saves=[];
      emit('workspace-backup-save-session',saves);
      await Promise.all(saves);
      const blob=await createWorkspaceBackup({includeLinux:includeLinux.checked});
      const date=new Date().toISOString().slice(0,10);
      download('GreenOS-'+date+WORKSPACE_BACKUP_EXTENSION,blob);
      showStatus('Резервная копия готова · '+bytes(blob.size));
    });

    importButton.onclick=run(async()=>{
      requireIdleWorkspace();
      const [file]=await pickFile(WORKSPACE_BACKUP_EXTENSION);
      if (!file || signal.aborted) return;
      showStatus('Проверяем резервную копию…');
      const prepared=await inspectWorkspaceBackup(file);
      const {summary}=prepared;
      const details=[
        'Копия от '+dateFormat.format(summary.created),
        summary.files+' файлов',
        summary.officeDrafts+' черновиков Office',
        summary.wallpapers+' обоев',
        summary.linuxSnapshots+' снимков Linux',
      ].join(' · ');
      showStatus(details);
      const accepted=await ask('Восстановить рабочее пространство?',{
        message:details+'. Файлы, настройки и черновики этого профиля будут заменены данными из копии.'
          + (summary.includeLinux?' Сохранённые снимки Linux в этом профиле тоже будут заменены.':'')
          + (navigator.locks?'':' Перед восстановлением закройте другие вкладки GreenOS.'),
        confirm:true,ok:'Восстановить рабочее пространство',
      });
      if (!accepted || signal.aborted) return;
      requireIdleWorkspace();
      showStatus('Восстанавливаем рабочее пространство…');
      emit('workspace-restore-start');
      try { await restoreWorkspaceBackup(prepared); }
      catch(error) { emit('workspace-restore-failed'); throw error; }
      location.reload();
    });

    const badge=el('div',{class:'recovery-symbol'});
    badge.innerHTML=icon('refresh');
    win.body.append(el('main',{class:'recovery-center'},
      el('header',{class:'recovery-heading'},badge,el('div',{},
        el('h1',{},'Центр восстановления'),
        el('p',{},'Продолжите работу с черновиком или перенесите рабочее пространство GreenOS.'))),
      el('section',{class:'recovery-card','aria-label':'Черновики Office'},
        el('h2',{},'Черновики Office'),
        el('p',{},'GreenOS автоматически записывает изменения Word, Excel и PowerPoint в хранилище браузера.'),
        draftList),
      el('section',{class:'recovery-card','aria-label':'Резервная копия рабочего пространства'},
        el('h2',{},'Резервная копия рабочего пространства'),
        el('p',{},'Файл .greenos переносит файлы, настройки, персонализацию, сеанс, прогресс игр и черновики Office.'),
        el('label',{class:'recovery-option'},includeLinux,'Включить сохранённые снимки Linux'),
        el('div',{class:'recovery-actions'},exportButton,importButton),status)));
    on('recovery',renderDrafts,signal);
    on('windows',renderDrafts,signal);
    void renderDrafts();
  },
};
