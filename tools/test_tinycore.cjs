const {chromium,launchOptions,baseURL,unlockDesktop}=require('./browser_test_support.cjs');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch(launchOptions());
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.on('pageerror',e=>console.error('PAGE ERROR:',e));
 try{
  await page.goto(baseURL);await unlockDesktop(page);await page.locator('.start-tinycore').click();
  for(let i=0;i<30;i++){
   await page.waitForTimeout(5000);
   const screen=await page.evaluate(async()=>{const {linux}=await import('/assets/linux.js');return {vm:!!linux.vm,running:linux.vm?.is_running(),text:linux.vm?.screen_adapter?.get_text_screen?.()?.join('\n'),canvas:document.querySelector('.vga-screen canvas')?.style.display,profile:linux.profile};});
   console.log(JSON.stringify({...screen,text:screen.text?.split('\n').filter(s=>s.trim()).slice(-3).join(' | ')}));
   await page.screenshot({path:'test-results/tinycore.png'});
   if(screen.canvas==='block'){
    await page.waitForTimeout(12000);
    await page.screenshot({path:'test-results/tinycore.png'});
    const visible=await page.locator('.vga-screen canvas').isVisible();
    if(!visible)throw new Error('Guest framebuffer is hidden');
    const varied=await page.locator('.vga-screen canvas').evaluate(canvas=>{const ctx=canvas.getContext('2d');const a=ctx.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<a.length;i+=400)if(a[i]+a[i+1]+a[i+2]>60)count++;return count;});
    if(varied<20)throw new Error('Graphical framebuffer is blank');
    console.log('PASS: Tiny Core graphical desktop is rendered and visible');return;
   }
  }
  throw new Error('Tiny Core did not reach its graphical display in 150 seconds');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
