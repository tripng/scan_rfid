require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database', 'presensi_rfid.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

// ---- helpers ----
function ok(data)  { res_handler(200, data); }
function created(data){ res_handler(201, data); }
function serverErr(msg){ res_handler(500, { error: msg }); }
function res_handler(status, body) {
  return (req, res) => res.status(status).json(body);
}

// ---- routes ----

/**
 * GET /
 * Health check.
 */
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Scan_Lab API', db: DB_PATH }));

/**
 * GET /api/ping
 * Latency + DB ping.
 */
app.get('/api/ping', (req, res) => {
  try {
    const r = db.prepare('SELECT 1 AS one').get();
    res.json({ pong: r.one === 1, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/scan/:uid
 * Lookup via VIEW v_scan_lookup (query/01_scan_lookup.sql).
 */
app.get('/api/scan/:uid', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT
        uid, tipe, nama, foto_path, status_aktif,
        siswa_id, nisn, kelas_id,
        guru_id, nip, jabatan,
        nama_kelas, tingkat
      FROM v_scan_lookup
      WHERE uid = ?
    `).get(req.params.uid);
    if (!row) return res.status(404).json({ error: 'UID tidak ditemukan atau tidak aktif' });
    // Jika foto_path NULL, kirimkan NISN/NIP agar klien bisa menyusun path foto otomatis.
    if (!row.foto_path) {
      row.foto_path = row.tipe === 'guru' ? row.nip : row.nisn;
    }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/scan
 * Log a scan attempt. Body: { uid, lokasi_id, jenis='masuk'|'keluar' }
 * Runs lookup + INSERT log_akses atomically.
 */
app.post('/api/scan', (req, res) => {
  const { uid, lokasi_id, jenis = 'masuk' } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid wajib' });

  const jenisValid = ['masuk', 'keluar'];
  if (!jenisValid.includes(jenis)) return res.status(400).json({ error: 'jenis harus masuk|keluar' });

  const tx = db.transaction((uid, lokasi_id, jenis) => {
    // 1. Caritransient first: does this uid exist as a card at all?
    const card = db.prepare('SELECT id, pengguna_id, status FROM rfid_card WHERE uid = ?').get(uid);
    if (!card) {
      return { status: 'gagal', reason: 'uid tidak terdaftar' };
    }

    // 2. Then check active chain.
    const lookup = db.prepare(`
      SELECT r.id AS rfid_id, p.id AS pengguna_id, p.status_aktif AS user_status, r.status AS card_status
      FROM rfid_card r
      JOIN pengguna p ON p.id = r.pengguna_id
      WHERE r.uid = ?
    `).get(uid);

    const inactiveReason =
      lookup.card_status !== 'aktif' ? 'kartu tidak aktif' :
      lookup.user_status !== 'aktif'  ? 'pengguna tidak aktif'  : null;

    // Default lokasi ke id=1 (Gerbang Utama) bila tidak dikirim — kolom NOT NULL
    const locId = lokasi_id || 1;

    if (inactiveReason) {
      const info = db.prepare(`
        INSERT INTO log_akses (rfid_id, lokasi_id, jenis, waktu_scan, status, keterangan, status_sync)
        VALUES (?, ?, ?, strftime('%s','now'), 'gagal', ?, 0)
      `).run(card.id, locId, jenis, inactiveReason);
      return { status: 'gagal', reason: inactiveReason, rfid_id: card.id, log_id: info.lastInsertRowid };
    }

    // 3. Active & valid -> cek anti-double-scan + auto-flip jenis.
    const ONE_MINUTE_MS = 60 * 1000;
    const last = db.prepare(`
      SELECT jenis, waktu_scan
      FROM log_akses
      WHERE rfid_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(lookup.rfid_id);

    let effectiveJenis = jenis;            // jenis yang akan dicatat
    let skipReason = null;                // null = boleh insert

    if (last) {
      // strftime('%s','now') = unix epoch (detik, UTC). Simpan sebagai integer
      // untuk hindari ambiguitas zona waktu. Gap dihitung dibandingkan
      // dengan Date.now() yang juga epoch UTC (kali 1000 = ms).
      const lastMs = Number(last.waktu_scan) * 1000;
      const nowMs  = Date.now();
      const gap    = nowMs - lastMs;

      if (gap < 0) {
        // Clock skew minor. Behandlung sebagai "lama" → flip.
        effectiveJenis = last.jenis === 'masuk' ? 'keluar' : 'masuk';
      } else if (gap < ONE_MINUTE_MS) {
        // Double-tap dalam < 1 menit: tolak, jangan insert.
        skipReason = 'scan terlalu cepat — abaikan (cooldown 60 detik)';
      } else {
        // ≥ 1 menit sejak scan terakhir → flip jenis (masuk↔keluar).
        effectiveJenis = last.jenis === 'masuk' ? 'keluar' : 'masuk';
      }
    }

    if (skipReason) {
      // Jangan insert ke log_akses. Beri tahu frontend lewat status 'dilewati'.
      return {
        status: 'dilewati',
        reason: skipReason,
        rfid_id: lookup.rfid_id,
        pengguna_id: lookup.pengguna_id,
        last_jenis: last ? last.jenis : null,
      };
    }

    // 3b. Active & valid -> insert log dengan jenis yang sudah diflip (bila perlu).
    const info = db.prepare(`
      INSERT INTO log_akses (rfid_id, lokasi_id, jenis, waktu_scan, status, keterangan, status_sync)
      VALUES (?, ?, ?, strftime('%s','now'), 'sukses', NULL, 0)
    `).run(lookup.rfid_id, locId, effectiveJenis);

    // Ambil detail profil lengkap via VIEW untuk frontend render
    const profile = db.prepare(`
      SELECT
        r.uid, p.tipe, p.nama, p.foto_path, p.status_aktif,
        s.id AS siswa_id, s.nisn, s.kelas_id,
        g.id AS guru_id, g.nip, g.jabatan,
        k.nama_kelas, k.tingkat
      FROM rfid_card r
      JOIN pengguna p ON p.id = r.pengguna_id
      LEFT JOIN siswa s ON s.id = p.id
      LEFT JOIN guru g  ON g.id = p.id
      LEFT JOIN kelas k ON k.id = s.kelas_id
      WHERE r.uid = ?
    `).get(uid);

    if (!profile.foto_path) {
      profile.foto_path = profile.tipe === 'guru' ? profile.nip : profile.nisn;
    }

    return {
      status: 'sukses',
      rfid_id: lookup.rfid_id,
      pengguna_id: lookup.pengguna_id,
      log_id: info.lastInsertRowid,
      jenis: effectiveJenis,
      ...profile,
    };
  });

  try {
    const result = tx(uid, lokasi_id || null, jenis);
    res.json({ uid, ...result, waktu_scan: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/log-akses
 * List log_akses with optional ?limit=&sync=0 filter.
 * Mirrors query/03_sync_queue.sql for status_sync=0.
 */
app.get('/api/log-akses', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const where = [];
    const args = [];
    if (req.query.sync === '0' || req.query.sync === 'false') { where.push('l.status_sync = 0'); }
    if (req.query.uid)  { where.push(`r.uid = ?`);   args.push(req.query.uid); }
    if (req.query.status){ where.push('l.status = ?'); args.push(req.query.status); }

    const sql = `
      SELECT l.id, l.rfid_id, l.lokasi_id, l.jenis, l.waktu_scan, l.status, l.keterangan, l.status_sync,
             r.uid, p.nama, p.tipe
      FROM log_akses l
      JOIN rfid_card r ON r.id = l.rfid_id
      JOIN pengguna p  ON p.id = r.pengguna_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY l.id DESC
      LIMIT ?
    `;
    args.push(limit);
    const rows = db.prepare(sql).all(...args);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/aktivitas-terakhir
 * 5 log presensi terakhir — otomatis ter-update tiap ada scan baru
 * karena query langsung baca dari log_akbes (ORDER BY id DESC LIMIT 5).
 * Response juga diload oleh endpoint ini sendiri agar frontend polling
 * selalu dapat data terbaru tanpa perlu polling penuh /api/log-akses.
 */
app.get('/api/aktivitas-terakhir', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        l.id, l.jenis, l.status, l.waktu_scan, l.keterangan, l.status_sync,
        p.tipe, p.nama, r.uid,
        s.nisn, s.kelas_id, k.nama_kelas, k.tingkat,
        g.nip, g.jabatan,
        lok.nama_lokasi
      FROM log_akses l
      JOIN rfid_card r ON r.id = l.rfid_id
      JOIN pengguna    p ON p.id = r.pengguna_id
      JOIN lokasi      lok ON lok.id = l.lokasi_id
      LEFT JOIN siswa  s ON s.id = p.id
      LEFT JOIN guru   g ON g.id = p.id
      LEFT JOIN kelas  k ON k.id = s.kelas_id
      WHERE l.status = 'sukses'
      ORDER BY l.id DESC
      LIMIT 5
    `).all();

    // Konversi epoch -> ISO agar frontend langsung pakai (zona waktu tetap UTC
    // di JSON, frontend tampilkan di WITA).
    const result = rows.map(r => ({
      ...r,
      waktu_scan: r.waktu_scan ? new Date(Number(r.waktu_scan) * 1000).toISOString() : null,
      // helper: label ringkas
      label: r.tipe === 'siswa'
        ? `${r.nama} (${r.nama_kelas || r.nisn || ''})`
        : `${r.nama} (${r.jabatan || ''})`,
    }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/sync
 * Mark logs as synced (status_sync = 1). Body: { ids: [1,2,3] }
 */
app.post('/api/sync', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids wajib array' });
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`UPDATE log_akses SET status_sync = 1 WHERE id IN (${placeholders})`).run(...ids);
  res.json({ updated: info.changes });
});

/**
 * GET /api/pengguna
 * List all active pengguna (siswa/guru) with detail.
 */
app.get('/api/pengguna', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT p.id, p.tipe, p.nama, p.foto_path, p.status_aktif, p.created_at,
             s.nisn, s.tahun_masuk, k.nama_kelas, k.tingkat,
             g.nip, g.jabatan
      FROM pengguna p
      LEFT JOIN siswa s ON s.id = p.id
      LEFT JOIN kelas k ON k.id = s.kelas_id
      LEFT JOIN guru g  ON g.id = p.id
      WHERE p.status_aktif = 'aktif'
      ORDER BY p.tipe, p.nama
    `).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/pengguna
 * Create pengguna (siswa or guru).
 * siswa body: { tipe:'siswa', nama, nisn, tahun_masuk, kelas_id }
 * guru body:   { tipe:'guru',  nama, nip, jabatan }
 */
app.post('/api/pengguna', (req, res) => {
  const { tipe, nama, status_aktif, ...rest } = req.body;
  if (!tipe || !nama || !['siswa','guru'].includes(tipe))
    return res.status(400).json({ error: 'tipe (siswa|guru) & nama wajib' });

  try {
    const tx = db.transaction((tipe, nama, status_aktif, rest) => {
      const info = db.prepare(`
        INSERT INTO pengguna (tipe, nama, status_aktif) VALUES (?, ?, ?)
      `).run(tipe, nama, status_aktif || 'aktif');
      const pid = info.lastInsertRowid;

      if (tipe === 'siswa') {
        const { nisn, tahun_masuk, kelas_id } = rest;
        if (!nisn) throw new Error('nisn wajib untuk siswa');
        db.prepare(`
          INSERT INTO siswa (id, nisn, tahun_masuk, kelas_id) VALUES (?, ?, ?, ?)
        `).run(pid, nisn, tahun_masuk || new Date().getFullYear(), kelas_id || null);
      } else if (tipe === 'guru') {
        const { nip, jabatan } = rest;
        db.prepare(`
          INSERT INTO guru (id, nip, jabatan) VALUES (?, ?, ?)
        `).run(pid, nip || null, jabatan || null);
      }
      return pid;
    });
    const pid = tx(tipe, nama, status_aktif || 'aktif', rest);
    res.status(201).json({ id: pid, tipe, nama });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') res.status(409).json({ error: 'NISN/NIP sudah terdaftar', detail: e.message });
    else res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/rfid
 * Assign RFID card to a pengguna. Body: { uid, pengguna_id }
 */
app.post('/api/rfid', (req, res) => {
  const { uid, pengguna_id } = req.body;
  if (!uid || !pengguna_id) return res.status(400).json({ error: 'uid & pengguna_id wajib' });
  try {
    const info = db.prepare(`
      INSERT INTO rfid_card (uid, pengguna_id, status, tanggal_terdaftar)
      VALUES (?, ?, 'aktif', date('now'))
    `).run(uid, pengguna_id);
    res.status(201).json({ id: info.lastInsertRowid, uid, pengguna_id });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') res.status(409).json({ error: 'UID sudah terdaftar', detail: e.message });
    else res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/rfid/:uid
 * Detail rfid_card by uid.
 */
app.get('/api/rfid/:uid', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT r.id, r.uid, r.pengguna_id, r.status, r.tanggal_terdaftar, r.created_at, p.nama, p.tipe
      FROM rfid_card r JOIN pengguna p ON p.id = r.pengguna_id
      WHERE r.uid = ?
    `).get(req.params.uid);
    if (!row) return res.status(404).json({ error: 'UID tidak ditemukan' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/kelas
 * Daftar kelas.
 */
app.get('/api/kelas', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, nama_kelas, tingkat, tahun_ajaran, created_at FROM kelas ORDER BY nama_kelas').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/lokasi
 * Daftar lokasi.
 */
app.get('/api/lokasi', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, nama_lokasi, jenis, created_at FROM lokasi ORDER BY id').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[Scan_Lab API] listening on http://localhost:${PORT}`);
  console.log(`[Scan_Lab API] DB: ${DB_PATH}`);
});

module.exports = { app, db, server };
