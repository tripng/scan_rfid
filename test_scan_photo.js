// Test visual: simulasi scan RFID via keyboard, verifikasi foto berubah sesuai NISN
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: undefined,
  });
  const page = await ctx.newPage();

  // Capture console untuk lihat log error
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());
  });
  page.on('pageerror', e => console.log('[PAGE ERROR]', e.message));

  await page.goto('http://localhost:4000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Helper: ketik UID + Enter ke hidden input
  async function scan(uid) {
    const input = await page.$('#rfid-input');
    await input?.focus();
    await input?.evaluate(el => el.value = '');
    await input?.type(uid);
    await input?.press('Enter');
    await page.waitForTimeout(800); // tunggu render + fetch
  }

  async function getPhotoSrc() {
    // Cari elemen dengan id student-photo
    const src = await page.$eval('#student-photo', el => el.src).catch(() => {
      console.log('  [DEBUG] #student-photo not found, dumping all imgs:');
      return 'NOTFOUND';
    });
    return src;
  }

  console.log('=== Baseline photo src ===');
  let src0 = await getPhotoSrc();
  console.log(src0);

  console.log('\n=== Scan siswa 1: UID 0002612308 (nisn 115571177) ===');
  await scan('0002612308');
  let src1 = await getPhotoSrc();
  console.log('After scan 1:', src1);
  const hasNisn1 = src1.includes('115571177');
  console.log('✅ Foto mengandung NISN 115571177?', hasNisn1);

  // Screenshot bukti
  await page.screenshot({ path: '/tmp/_scan_test_1.png', fullPage: false });

  console.log('\n=== Scan siswa 2: UID 0006030620 (nisn 3117754351) ===');
  await scan('0006030620');
  let src2 = await getPhotoSrc();
  console.log('After scan 2:', src2);
  const hasNisn2 = src2.includes('3117754351');
  console.log('✅ Foto mengandung NISN 3117754351?', hasNisn2);

  const changed = src1 !== src2;
  console.log('\n=== Foto berubah antar scan? ===', changed ? '✅ YES' : '❌ NO SAME!');

  await page.screenshot({ path: '/tmp/_scan_test_2.png', fullPage: false });

  console.log('\n=== SUMMARY ===');
  console.log('Scan1 (115571177) OK:', hasNisn1);
  console.log('Scan2 (3117754351) OK:', hasNisn2);
  console.log('Photo changed:', changed);
  console.log('ALL PASS:', hasNisn1 && hasNisn2 && changed);

  await browser.close();
  process.exit(hasNisn1 && hasNisn2 && changed ? 0 : 1);
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
