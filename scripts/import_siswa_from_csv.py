#!/usr/bin/env python3
"""
import_siswa_from_csv.py  (v2 — kompatibel schema SSO pengguna)
Impor Data Siswa - X.csv (kolom: nama,nisn,kelas) ke presensi_rfid.db
- Buat kelas (idempotent INSERT OR IGNORE).
- Buat pengguna(tipe='siswa') + siswa(id=samanya) untuk tiap baris CSV.
- Idempotent: INSERT OR IGNORE — jalankan berulang aman.
- tahun_masuk asumsi 2025 (CSV tidak bawa kolom); override via arg ENV TAHUN_MASUK.
"""
import csv, re, sqlite3, os

CSV_PATH      = "/home/tripng/Projects/Scan_Lab/Data Siswa - X.csv"
DB_PATH       = "/home/tripng/Projects/Scan_Lab/database/presensi_rfid.db"
DEFAULT_TAHUN = os.getenv("TAHUN_AJARAN", "2026/2027")
DEFAULT_MASUK = int(os.getenv("TAHUN_MASUK", "2025"))

def tingkat_from_kelas(kelas: str) -> str:
    m = re.match(r"^([0-9]+|[XVI]+)\.?", kelas or "")
    return m.group(1) if m else ""

def main():
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = ON;")
    cur = con.cursor()
    n_kelas_new = n_siswa_new = 0
    kelas_cache: dict[str,int] = {}
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        r = csv.reader(f)
        for row in r:
            if len(row) < 3:
                continue
            nama, nisn, kelas = row[0].strip(), row[1].strip(), row[2].strip()
            if not nisn:
                continue
            # --- kelas ---
            if kelas not in kelas_cache:
                tk = tingkat_from_kelas(kelas)
                cur.execute(
                    "INSERT OR IGNORE INTO kelas (nama_kelas, tingkat, tahun_ajaran) "
                    "VALUES (?,?,?)", (kelas, tk, DEFAULT_TAHUN))
                kid = cur.lastrowid or \
                    cur.execute("SELECT id FROM kelas WHERE nama_kelas=? AND tahun_ajaran=?",
                                (kelas, DEFAULT_TAHUN)).fetchone()[0]
                kelas_cache[kelas] = kid
                if cur.rowcount == 1:
                    n_kelas_new += 1
            kid = kelas_cache[kelas]
            # --- pengguna (siswa) ---
            # siswa.id = pengguna.id via ON DELETE CASCADE sehingga insert pengguna lalu siswa sama id
            cur.execute(
                "INSERT OR IGNORE INTO pengguna (tipe, nama, status_aktif) "
                "VALUES ('siswa', ?, 'aktif')", (nama,))
            uid = cur.lastrowid
            if uid is None:
                # sudah ada, ambil id
                uid = cur.execute("SELECT id FROM pengguna WHERE tipe='siswa' AND nama=?", (nama,)).fetchone()[0]
            else:
                n_siswa_new += 1
            # --- siswa subtype ---
            cur.execute(
                "INSERT OR IGNORE INTO siswa (id, nisn, tahun_masuk, kelas_id) "
                "VALUES (?,?,?,?)", (uid, nisn, DEFAULT_MASUK, kid))
    con.commit()
    print(f"kelas baru dibuat: {n_kelas_new} | siswa(baru) terimport: {n_siswa_new}")
    tot_s = cur.execute("SELECT COUNT(*) FROM siswa").fetchone()[0]
    tot_p = cur.execute("SELECT COUNT(*) FROM pengguna WHERE tipe='siswa'").fetchone()[0]
    tot_k = cur.execute("SELECT COUNT(*) FROM kelas").fetchone()[0]
    print(f"total di DB -> pengguna(siswa)={tot_p}, kelas={tot_k}, siswa(subtype)={tot_s}")
    con.close()

if __name__ == "__main__":
    main()
