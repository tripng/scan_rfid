#!/usr/bin/env bash
# migrate_v2.sh — rebuild DB ke schema SSO (pengguna->siswa/guru)
set -euo pipefail
cd "$(dirname "$0")"
DB="database/presensi_rfid.db"

# 1. backup kecil: export master data yang harus bertahan
sqlite3 -csv "$DB" "SELECT id,nama_kelas,tingkat,tahun_ajaran FROM kelas;"                    > /tmp/_kelas.csv
sqlite3 -csv "$DB" "SELECT id,nama_lokasi,jenis FROM lokasi;"                              > /tmp/_lokasi.csv
sqlite3 -csv "$DB" "SELECT id,lokasi_id,total_komputer,jumlah_baris,jumlah_kolom FROM labkom;"> /tmp/_labkom.csv
sqlite3 -csv "$DB" "SELECT id,rfid_id,lokasi_id,jenis,waktu_scan,status,keterangan,status_sync FROM log_akses;" > /tmp/_log.csv
sqlite3 -csv "$DB" "SELECT uid, s.nisn, s.nama FROM rfid_card r JOIN siswa s ON s.id=r.siswa_id JOIN kelas k ON k.id=s.kelas_id WHERE r.uid IN ('A1B2C3D4E5','F6E7D8C9B0','1122AABBCC');" > /tmp/_rfid.csv

echo "backup exported."
# 2. hapus DB + recreate
rm -f "$DB"
sqlite3 "$DB" < database/schema.sql
echo "schema v2 built."

# 3. re-seed demo (kelas X, siswa, guru) — tapi akan di-overwrite oleh import CSV
bash seed/seed_demo.sh >/dev/null 2>&1 || true

# 4. import CSV (buat pengguna+siswa, link rfid ke pengguna)
python3 scripts/import_siswa_from_csv.py

# 5. re-link rfid_card demo ke pengguna (uid masih sama, cari pengguna by nisn)
sqlite3 "$DB" <<'SQL'
UPDATE rfid_card SET pengguna_id = (SELECT p.id FROM pengguna p JOIN siswa s ON s.id=p.id WHERE s.nisn='115571177') WHERE uid='A1B2C3D4E5';
UPDATE rfid_card SET pengguna_id = (SELECT p.id FROM pengguna p JOIN siswa s ON s.id=p.id WHERE s.nisn='3117754351') WHERE uid='F6E7D8C9B0';
UPDATE rfid_card SET pengguna_id = (SELECT p.id FROM pengguna p JOIN siswa s ON s.id=p.id WHERE s.nisn='112395623')  WHERE uid='1122AABBCC';
SQL
echo "migrate complete."
