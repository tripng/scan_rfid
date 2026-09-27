-- query/02_log_scan.sql
-- Simpan log akses setelah scan berhasil.
-- :rfid_id / :lokasi_id diproleh dari hasil query 01 (join rfid_card).
INSERT INTO log_akses (rfid_id, lokasi_id, jenis, waktu_scan, status, keterangan, status_sync)
VALUES (:rfid_id, :lokasi_id, :jenis, :waktu_scan, 'sukses', NULL, 0);

-- query/03_sync_queue.sql
-- Ambil batch log belum tersinkron ke Hostinger (status_sync = 0)
SELECT id, rfid_id, lokasi_id, jenis, waktu_scan, status, keterangan
FROM log_akses
WHERE status_sync = 0
ORDER BY id ASC
LIMIT 100;
