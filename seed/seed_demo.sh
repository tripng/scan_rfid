#!/usr/bin/env bash
# seed/seed_demo.sh — data contoh: 1 guru + 3 kartu RFID demo (siswa palsu)
# Hanya untuk dev/testing scan. Dipisahkan dari import CSV.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="database/presensi_rfid.db"
sqlite3 "$DB" <<'SQL'
-- Guru (sudah ada dari import CSV sebelumnya; ini tes paling baru)
INSERT OR IGNORE INTO pengguna (tipe,nama,status_aktif) VALUES ('guru','Pak Budi','aktif');
INSERT OR IGNORE INTO guru (id,nip,jabatan)
SELECT p.id,'998877665544','Kepala Lab' FROM pengguna p
WHERE p.tipe='guru' AND p.nama='Pak Budi' AND NOT EXISTS (SELECT 1 FROM guru WHERE guru.id=p.id);

-- 3 kartu RFID demo untuk siswa pertama di CSV
INSERT OR IGNORE INTO rfid_card (uid,pengguna_id,status)
SELECT 'A1B2C3D4E5', p.id, 'aktif'
FROM pengguna p JOIN siswa s ON s.id=p.id LIMIT 1;
INSERT OR IGNORE INTO rfid_card (uid,pengguna_id,status)
SELECT 'F6E7D8C9B0', p.id, 'aktif'
FROM pengguna p JOIN siswa s ON s.id=p.id LIMIT 1 OFFSET 1;
INSERT OR IGNORE INTO rfid_card (uid,pengguna_id,status)
SELECT '1122AABBCC', p.id, 'aktif'
FROM pengguna p JOIN siswa s ON s.id=p.id LIMIT 1 OFFSET 2;

-- 3 lokasi
INSERT OR IGNORE INTO lokasi (nama_lokasi,jenis) VALUES
  ('Gerbang Utama','gerbang'),
  ('Lab Komputer 1','lab'),
  ('Kelas 7A','kelas');
SQL
echo "=== demo users with rfid ==="
sqlite3 -header -column "$DB" \
"SELECT r.uid,p.tipe,p.nama,s.nisn FROM rfid_card r
 JOIN pengguna p ON p.id=r.pengguna_id
 LEFT JOIN siswa s ON s.id=p.id ORDER BY r.uid;"