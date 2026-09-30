// Headless E2E verify: fokus input teks + keyboard event injection
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Tangkap console JS di browser
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  page.on('pageerror', err => logs.push('PAGEERROR: ' + err.message));

  await page.goto('http://localhost:4000/', { waitUntil: 'networkidle' });

  // Verifikasi elemen ada dan tipe-nya text
  const inputInfo = await page.evaluate(() => {
    const el = document.querySelector('#rfid-input');
    if (!el) return { exists: false };
    el.focus();
    return {
      exists: true,
      tagName: el.tagName,
      type: el.type,
      tabIndex: el.tabIndex,
      isFocusVisible: document.activeElement === el
    };
  });
  console.log('INPUT INFO:', JSON.stringify(inputInfo, null, 2));

  // Inject keyboard typing + Enter untuk simulasi RFID scan
  await page.focus('#rfid-input');
  await page.keyboard.type('ABCDEF1234');
  await page.keyboard.press('Enter');

  // Beri waktu fetch selesai, cek DOM render
  await page.waitForTimeout(800);

  // Cek apakah statusCard berubah (bukti handleScan terpanggil)
  const statusCard = await page.$eval('#status-card', el => el.textContent) || 'NO STATUS CARD';
  const nameEl = await page.$eval('#student-name', el => el.textContent) || 'NO NAME';
  console.log('STATUS CARD:', statusCard);

  await browser.close();
  if (logs.length) console.log('BROWSER LOGS:', logs);
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
