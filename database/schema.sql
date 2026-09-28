-- =====================================================
--  Presensi RFID — SQLite schema (v2 — SSO login by tipe)
--  pengguna = tabel induk (siswa & guru). RFID bisa scan SISWA maupun GURU.
--  MySQL → SQLite: ENUM->TEXT+CHECK, AUTO->AUTOINCREMENT, YEAR/TINYINT->INTEGER.
--
--  Wajib di setiap koneksi SQLite:
--      PRAGMA foreign_keys = ON;
--  Trigger updated_at diletakkan SETELAH semua tabel referensinya ada,
--  supaya CREATE TRIGGER tidak gagal "no such table" pada cold-applied DB.
-- =====================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- =====================================================
-- 1. PENGGUNA (tabel induk — siapa saja yang bisa scan)
-- =====================================================
CREATE TABLE IF NOT EXISTS pengguna (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tipe            TEXT NOT NULL
                      CHECK (tipe IN ('siswa','guru')),
    nama            TEXT NOT NULL,
    foto_path       TEXT,                 -- path/nama file foto lokal
    status_aktif    TEXT DEFAULT 'aktif'
                      CHECK (status_aktif IN ('aktif','nonaktif')),
    created_at      TEXT DEFAULT (CURRENT_TIMESTAMP),
    updated_at      TEXT DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_pengguna_tipe ON pengguna(tipe);

-- =====================================================
-- 2. SISWA (subtype pengguna; id = PK sekaligus FK ke pengguna)
-- =====================================================
CREATE TABLE IF NOT EXISTS siswa (
    id              INTEGER PRIMARY KEY,          -- PK + FK sama dengan pengguna.id
    nisn            TEXT NOT NULL UNIQUE,
    tahun_masuk     INTEGER NOT NULL,             -- YEAR -> INTEGER
    kelas_id        INTEGER,
    FOREIGN KEY (id)      REFERENCES pengguna(id) ON DELETE CASCADE,
    FOREIGN KEY (kelas_id) REFERENCES kelas(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_siswa_nisn  ON siswa(nisn);
CREATE INDEX IF NOT EXISTS idx_siswa_kelas ON siswa(kelas_id);

-- =====================================================
-- 3. GURU (subtype pengguna; id = PK sekaligus FK ke pengguna)
-- =====================================================
CREATE TABLE IF NOT EXISTS guru (
    id              INTEGER PRIMARY KEY,          -- PK + FK sama dengan pengguna.id
    nip             TEXT NOT NULL UNIQUE,
    jabatan         TEXT,                 -- misal: "Guru Mapel", "Kepala Lab"
    FOREIGN KEY (id) REFERENCES pengguna(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_guru_nip ON guru(nip);

-- =====================================================
-- 4. KARTU RFID (scan untuk siswa maupun guru via pengguna_id)
-- =====================================================
CREATE TABLE IF NOT EXISTS rfid_card (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    uid             TEXT NOT NULL UNIQUE,   -- ID unik fisik kartu
    pengguna_id     INTEGER NOT NULL,       -- dulunya siswa_id — sekarang SEMUA pengguna
    status          TEXT DEFAULT 'aktif'
                      CHECK (status IN ('aktif','hilang','nonaktif')),
    tanggal_terdaftar TEXT DEFAULT (date('now')),
    created_at      TEXT DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (pengguna_id) REFERENCES pengguna(id)
);
-- INDEX KRITIS: lookup uid saat scan harus pakai ini (index unik)
CREATE INDEX IF NOT EXISTS idx_rfid_uid     ON rfid_card(uid);
CREATE INDEX IF NOT EXISTS idx_rfid_pengguna ON rfid_card(pengguna_id);
CREATE INDEX IF NOT EXISTS idx_rfid_status   ON rfid_card(status);

-- =====================================================
-- 5. KELAS — tidak berubah
-- =====================================================
CREATE TABLE IF NOT EXISTS kelas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nama_kelas      TEXT NOT NULL,          -- misal: "7A", "X.1"
    tingkat         TEXT,                   -- misal: "7", "XII"
    tahun_ajaran    TEXT,                   -- misal: "2026/2027"
    created_at      TEXT DEFAULT (CURRENT_TIMESTAMP),
    updated_at      TEXT DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_kelas_tingkat ON kelas(tingkat);

-- =====================================================
-- 6. LOKASI / TITIK SCAN — tidak berubah
-- =====================================================
CREATE TABLE IF NOT EXISTS lokasi (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nama_lokasi     TEXT NOT NULL,
    jenis           TEXT DEFAULT 'lainnya'
                      CHECK (jenis IN ('gerbang','lab','kelas','lainnya')),
    created_at      TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- =====================================================
-- 7. LAB KOMPUTER — tidak berubah
-- =====================================================
CREATE TABLE IF NOT EXISTS labkom (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lokasi_id       INTEGER,
    total_komputer  INTEGER NOT NULL,
    jumlah_baris    INTEGER NOT NULL,
    jumlah_kolom    INTEGER,
    created_at      TEXT DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (lokasi_id) REFERENCES lokasi(id)
);
CREATE INDEX IF NOT EXISTS idx_labkom_lokasi ON labkom(lokasi_id);

-- =====================================================
-- 8. LOG AKSES — tidak berubah (menunjuk rfid_id)
-- =====================================================
CREATE TABLE IF NOT EXISTS log_akses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid_id         INTEGER NOT NULL,
    lokasi_id       INTEGER NOT NULL,
    jenis           TEXT NOT NULL
                      CHECK (jenis IN ('masuk','keluar')),
    waktu_scan      TEXT NOT NULL,          -- unix epoch (strftime('%s','now')), UTC
    status          TEXT NOT NULL
                      CHECK (status IN ('sukses','gagal')),
    keterangan      TEXT,
    status_sync     INTEGER DEFAULT 0,      -- TINYINT(1) -> INTEGER (0/1)
    FOREIGN KEY (rfid_id)   REFERENCES rfid_card(id),
    FOREIGN KEY (lokasi_id) REFERENCES lokasi(id)
);
CREATE INDEX IF NOT EXISTS idx_log_waktu   ON log_akses(waktu_scan);
CREATE INDEX IF NOT EXISTS idx_log_sync    ON log_akses(status_sync);
CREATE INDEX IF NOT EXISTS idx_log_rfid    ON log_akses(rfid_id);
CREATE INDEX IF NOT EXISTS idx_log_lokasi  ON log_akses(lokasi_id);
CREATE UNIQUE INDEX IF NOT EXISTS unik_scan
    ON log_akses (rfid_id, lokasi_id, waktu_scan);

-- =====================================================
-- 9. VIEW: join cepat scan-by-uid (termasuk tipe pengguna)
--   SELECT * FROM v_scan_lookup WHERE uid=?;
-- =====================================================
CREATE VIEW IF NOT EXISTS v_scan_lookup AS
SELECT
    r.uid,
    p.id          AS pengguna_id,
    p.tipe,
    p.nama,
    p.foto_path,
    p.status_aktif,
    s.id          AS siswa_id,
    s.nisn,
    s.kelas_id,
    g.id          AS guru_id,
    g.nip,
    g.jabatan,
    k.nama_kelas,
    k.tingkat
FROM rfid_card r
JOIN pengguna   p ON p.id = r.pengguna_id
LEFT JOIN siswa  s ON s.id = p.id
LEFT JOIN guru   g ON g.id = p.id
LEFT JOIN kelas  k ON k.id = s.kelas_id
WHERE r.status = 'aktif' AND p.status_aktif = 'aktif';

-- =====================================================
-- Triggers updated_at — diletakkan paling akhir agar semua
-- tabel referensi sudah ada saat CREATE TRIGGER pada cold DB.
-- =====================================================
CREATE TRIGGER IF NOT EXISTS trg_pengguna_updated
    AFTER UPDATE ON pengguna
BEGIN
    UPDATE pengguna SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_siswa_updated
    AFTER UPDATE ON siswa
BEGIN
    -- sinkronkan updated_at ke induk pengguna agar stale-flag konsisten
    UPDATE pengguna SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_guru_updated
    AFTER UPDATE ON guru
BEGIN
    UPDATE pengguna SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_kelas_updated
    AFTER UPDATE ON kelas
BEGIN
    UPDATE kelas SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
