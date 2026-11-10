const fs=require('node:fs');
const path=require('node:path');
let runtime;
for(const name of [process.env.PLAYWRIGHT_MODULE,'playwright','playwright-core','./qa-runtime/package'].filter(Boolean)){
  try{runtime=require(name);break;}catch{}
}
if(!runtime)throw new Error('Install Playwright separately, or set PLAYWRIGHT_MODULE to its module path.');
exports.chromium=runtime.chromium;
exports.launchOptions=()=>{
  const bundled=process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'ms-playwright/chromium-1228/chrome-win64/chrome.exe');
  const executablePath=process.env.CHROMIUM_EXECUTABLE||(bundled&&fs.existsSync(bundled)?bundled:undefined);
  return {headless:true,...(executablePath?{executablePath}:{})};
};
exports.baseURL=process.env.GREENOS_TEST_URL||'http://127.0.0.1:8000';
exports.unlockDesktop=async page=>{
  await page.locator('#unlock').click({timeout:30000});
  await page.locator('#lock-screen').waitFor({state:'hidden'});
};
