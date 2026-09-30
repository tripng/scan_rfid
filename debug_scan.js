// Debug script: buka browser VISIBLE (headless:false) di localhost:4000
// Inject logger ke #rfid-input keydown/input + window.__rfid_buffer
// Jalankan RFID reader fisik / ketik keyboard apa saja di window ini.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,               // VISIBLE agar HID keyboard sampai
    args: ['--autoplay-policy=no-user-gesture-required']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('RFID-DBG')) console.log('  [BROWSER] ' + t);
  });
  page.on('pageerror', e => console.log('  [BROWSER ERROR] ' + e.message));

  await page.goto('http://localhost:4000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Inject debug instrumentation
  await page.addInitScript(() => {
    let buf = '';
    window.__rfid_buf = '';
    window.__rfid_log = [];
    ['keydown','keypress'].forEach(evType => {
      document.addEventListener(evType, e => {
        window.__rfid_buf += e.key;
        window.__rfid_log.push({ t: Date.now(), ev: evType, key: e.key, code: e.code });
        console.log('RFID-DBG ' + evType + ': key="' + e.key + '" code="' + e.code + '" target=' + e.target.id + ' buffer="' + window.__rfid_buf + '"');
      }, true); // capture phase — tangkap sebelum siap-siap difilter
    });
    // fokuskan tiap 2s biar reader selalu mengetik ke elemen ini
    setInterval(() => { document.querySelector('#rfid-input')?.focus(); }, 2000);
    document.querySelector('#rfid-input')?.focus();
    console.log('RFID-DBG instrumentation attached. Scan kartu RFID / ketik di window ini.');
  });

  // re-attach after navigation karena addInitScript hanya sekali, navigasi ulang = reset
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction('window.__rfid_log !== undefined');

  console.log('========================================');
  console.log(' Scanner HID active on THIS browser window');
  console.log(' Scan RFID card now, or type on keyboard.');
  console.log(' Close browser window when done to exit.');
  console.log('========================================');

  // biar proses tetap hidup sampai kamu close window
  browser.on('disconnected', () => process.exit(0));
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
