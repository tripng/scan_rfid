/**
 * sync.js — Background batch sync worker.
 *
 * Tiap SYNC_INTERVAL_MS (default 60s), kirim batch rekaman log_akses dengan
 * status_sync=0 ke API eksternal (POST /api/log-akses/batch). Jika API
 * membalas sukses (HTTP 2xx), tandai status_sync=1 untuk record yang
 * dikonfirmasi diterima. Jika gagal (network/timeout/non-2xx), biarkan
 * rekaman — akan dicoba kembali di siklus berikutnya.
 *
 * Jika siklus sebelumnya masih berjalan (request belum selesai), jangan
 * mulai siklus baru: lewati ke menit berikutnya agar tidak menumpuk request.
 *
 * Config via env (bisa override .env):
 *   SYNC_INTERVAL_MS  — jeda antar siklus (default 60000 = 1 menit)
 *   SYNC_BATCH_SIZE   — max record per batch (default 100)
 *   SYNC_API_URL      — endpoint API (default http://localhost:8000/api/log-akses/batch)
 *   SCAN_APP_TOKEN    — bearer token (dibaca .env)
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database', 'presensi_rfid.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS, 10) || 60_000; // 1 menit
const SYNC_BATCH_SIZE  = parseInt(process.env.SYNC_BATCH_SIZE, 10)  || 100;
const SYNC_API_URL     = process.env.SYNC_API_URL || 'http://localhost:8000/api/log-akses/batch';
const SCAN_APP_TOKEN   = process.env.SCAN_APP_TOKEN;

// State: apakah request sebelumnya masih berjalan?
let inFlight = false;
let timerId = null;

function log(msg, ...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}][sync] ${msg}`, ...args);
}

/**
 * Ambil batch record belum tersinkron (status_sync=0), urut id ASC agar
 * data terlama dikirim lebih dulu. Kolom-kolom yang dikirimkan sesuaikan
 * spec API batch: rfid_id, lokasi_id, jenis, waktu_scan, status, keterangan.
 */
function fetchBatch() {
  return db.prepare(`
    SELECT id, rfid_id, lokasi_id, jenis, waktu_scan, status, keterangan
    FROM log_akses
    WHERE status_sync = 0
    ORDER BY id ASC
    LIMIT ?
  `).all(SYNC_BATCH_SIZE);
}

/**
 * Kirim batch ke API. Kembalikan { ok: true } bila sukses.
 * Tangani semua failure mode (network, non-2xx, parse body) sebagai ok: false
 * agar record tetap dipertahatkan untuk dicoba kembali.
 */
async function sendBatch(rows) {
  if (!rows || rows.length === 0) return { ok: true, skipped: true };
  if (!SCAN_APP_TOKEN) return { ok: false, error: 'SCAN_APP_TOKEN missing' };

  const payload = {
    data: rows.map(r => ({
      rfid_id:    r.rfid_id,
      lokasi_id:  r.lokasi_id,
      jenis:      r.jenis,
      waktu_scan: String(r.waktu_scan),
      status:     r.status,
      // keterangan hanya kirim bila ada isinya (mis. 'batch ke-2')
      ...(r.keterangan ? { keterangan: r.keterangan } : {}),
    })),
  };

  try {
    const res = await fetch(SYNC_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SCAN_APP_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // Jangan biarkan request ngelang-ngung; timeout eksternal lewat
      // AbortController agar tidak menghalangi siklus berikutnya.
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '<unreadable>');
      return { ok: false, error: `HTTP ${res.status}`, body: txt.slice(0, 200) };
    }

    // API sukses → tandai semua id dalam batch ini sebagai tersinkron.
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const info = db.prepare(`UPDATE log_akses SET status_sync = 1 WHERE id IN (${placeholders})`).run(...ids);
    log(`✓ synced ${info.changes} record(s) — ids: ${ids.slice(0, 10).join(',')}${ids.length > 10 ? '...' : ''}`);
    return { ok: true, synced: info.changes };
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    log(`✗ batch gagal${isTimeout ? ' (timeout)' : ''}: ${err.message || err}`);
    // Gagal → jangan update status_sync. Biarkan record untuk dicoba kembali.
    return { ok: false, error: err.message };
  }
}

/**
 * Siklus sync satu kali. Guard inFlight mencegah overlap antar request.
 */
async function runCycle() {
  if (inFlight) {
    log('siklus sebelumnya masih berjalan — lewati ke menit berikutnya');
    return;
  }
  inFlight = true;
  try {
    const rows = fetchBatch();
    if (rows.length === 0) {
      log('tidak ada record belum sync');
    } else {
      log(`kirim batch ${rows.length} record...`);
      const result = await sendBatch(rows);
      if (!result.ok && !result.skipped) {
        log('batch tidak berhasil — record dibiarkan untuk siklus berikutnya');
      }
    }
  } finally {
    inFlight = false;
  }
}

// ---- bootstrap (hanya jalankan scheduler bila dijalankan langsung: node sync.js) ----
if (require.main === module) {
  log(`start — interval=${SYNC_INTERVAL_MS}ms batch=${SYNC_BATCH_SIZE} url=${SYNC_API_URL} token=${SCAN_APP_TOKEN ? '***yes***' : '***MISSING***'}`);
  // Jalankan sekali segera, lalu setiap interval.
  runCycle();
  timerId = setInterval(runCycle, SYNC_INTERVAL_MS);
  // Graceful shutdown agar DB flush.
  process.on('SIGINT',  () => { log('shutdown...'); clearInterval(timerId); db.close(); process.exit(0); });
  process.on('SIGTERM', () => { log('shutdown...'); clearInterval(timerId); db.close(); process.exit(0); });
}

// Graceful shutdown (untua via require di test runner — clearInterval no-op bila timerId null).
process.on('SIGINT', () => { clearInterval(timerId); db.close(); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(timerId); db.close(); process.exit(0); });

module.exports = { fetchBatch, sendBatch, runCycle }; // ekspor untuk test

