-- query/01_scan_lookup.sql
-- Lookup kecepatan scan-by-uid via VIEW v_scan_lookup (menggunakan idx_rfid_uid).
-- Mengembalikan data LENGKAP baik untuk SISWA maupun GURU.
SELECT
    uid, tipe, nama, foto_path, status_aktif,
    siswa_id, nisn, kelas_id,
    guru_id, nip, jabatan,
    nama_kelas, tingkat
FROM v_scan_lookup
WHERE uid = :uid;
