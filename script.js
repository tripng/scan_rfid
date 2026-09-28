(function () {
  "use strict";

  /* =========================================================================
   * Kiosk Presensi — RFID USB-HID Keyboard Emulasi Integration
   * -------------------------------------------------------------------------
   * Reader = keyboard emulasi: ketik UID lalu Enter. Script mengumpulkan
   * karakter sampai Enter, lalu fetch /api/scan/<uid> dan inject hasil ke DOM.
   * Setelah inject, fokus langsung kembali ke #rfid-input agar siap scan
   * berikutnya (latency ~0ms per gap, hanya HTTP roundtrip localhost).
   * ========================================================================= */

  const HIDDEN_INPUT = "#rfid-input";
  const API_BASE = "/api";
  // Lokasi/tempat scan — bisa override via query param ?lokasi_id=<id>
  const LOKASI_ID = new URLSearchParams(location.search).get("lokasi_id") || null;
  const JENIS_DEFAULT = "masuk";

  // ---- DOM target (id yang ditambahkan di index.html) ----
  const els = {
    statusCard:  document.getElementById("status-card"),
    statusSub:   document.getElementById("status-sub"),
    name:        document.getElementById("student-name"),
    kelas:       document.getElementById("student-kelas"),
    nisn:        document.getElementById("student-nisn"),
    badge:       document.getElementById("student-badge"),
    photo:       document.getElementById("student-photo"),
  };

  // ---- state penumpukan karakter RFID ----
  let buffer = "";

  /**
   * Focus hidden input agar event keyboard selalu tertangkap.
   * Di panggil saat load & setelah tiap scan selesai.
   */
  function focusInput() {
    const inp = document.querySelector(HIDDEN_INPUT);
    if (inp) inp.focus();
  }

  /**
   * Reset tampilan ke state "tempelkan kartu".
   * Dipanggil setelah 2 detik sukses — kembali siap untuk scan berikutnya.
   */
  function resetToScanPrompt() {
    if (els.statusCard) els.statusCard.textContent = "TEMPELKAN KARTU PELAJAR";
    if (els.statusSub)  els.statusSub.textContent = "Tempelkan Kartu RFID Anda di Alat Pemindai";
    focusInput();
  }

  /**
   * Inject data siswa/guru ke kartu profil.
   * @param {object} data — payload dari GET /api/scan/:uid
   */
  function renderProfile(data, jenis) {
    const typeLabel = data.tipe === "siswa" ? "Siswa" : "Guru";
    const aktifLabel = data.status_aktif === "aktif" ? "Aktif" : "Nonaktif";
    const jenisLabel = (jenis || "masuk").toUpperCase();
    const nowStr = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

    if (els.statusCard) els.statusCard.textContent = `Selamat Datang Di LAB MAN 1`;
    if (els.statusSub)  els.statusSub.textContent = `${typeLabel} — ${data.nama} | ${jenisLabel} ${nowStr} WITA`;
    if (els.name)       els.name.textContent = data.nama || "-";
    if (els.kelas)      els.kelas.textContent =
      (data.nama_kelas ? data.nama_kelas : data.jabatan) || "-";
    if (els.nisn) {
      els.nisn.textContent = data.nisn || data.nip || "-";
      // label NISN otomatis ikut ganti jadi NIP bila guru
      const labelEl = els.nisn.previousElementSibling;
      if (labelEl) labelEl.textContent = data.tipe === "guru" ? "NIP" : "NISN";
    }
    if (els.badge) els.badge.textContent = `${typeLabel} ${aktifLabel}`;

    // foto: jika DB kembalikan path, pakai relatif dari root serve; fallback placeholder
    if (els.photo) {
      if (data.foto_path) {
        // Pastikan path foto punya ekstensi .jpg/.png (NISN/NIP dari DB tidak bawa ekstensi).
        const fotoPath = /\.(jpg|jpeg|png|webp)$/i.test(data.foto_path)
          ? data.foto_path
          : `${data.foto_path}.jpg`;
        // Cache-bust dengan timestamp supaya foto berubah ketika NISN/NIP berubah
        els.photo.src = `./photos/${encodeURIComponent(fotoPath)}?t=${Date.now()}`;
        els.photo.alt = `${data.nama}`;
      } else {
        // fallback SVG placeholder (data URI, no eksternal file perlu)
        els.photo.src =
          "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjE0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjE0MCIgZmlsbD0iI2Y1ZmZmZiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNsaW5lPSJtaWQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2FucXMtc2VyaWYiIGZvbnRzaXplPSIxNCIgZmlsbD0iIzkyYzUzNCI+Tm9JbWFnZTwvdGV4dD48L3N2Zz4=";
        els.photo.alt = `${data.nama}`;
      }
    }

    // auto-reset setelah ~2 detik agi siap amb scan berikutnya
    clearTimeout(window.__resetTimer);
    window.__resetTimer = setTimeout(resetToScanPrompt, 2000);
  }

  /**
   * POST lookup+log UID ke backend.
   * Menggunakan POST /api/scan supaya otomatis INSERT ke log_akses
   * (status sukses/gagal) sekaligus mengembalikan data profil.
   */
  async function handleScan(uid) {
    try {
      const res = await fetch(`${API_BASE}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ uid, lokasi_id: LOKASI_ID, jenis: JENIS_DEFAULT }),
      });
      const data = await res.json();

      // gagal = kartu/tidak aktif/uid tidak terdaftar
      if (!res.ok || data.status === 'gagal' || data.status === 'dilewati') {
        if (data.status === 'dilewati') {
          if (els.statusCard) els.statusCard.textContent = "Sudah Melakukan Scan";
          if (els.statusSub)  els.statusSub.textContent = data.reason || "Scan terlalu cepat, tunggu 60 detik";
        } else {
          if (els.statusCard) els.statusCard.textContent = "KARTU TIDAK DITEMUKAN";
          if (els.statusSub)  els.statusSub.textContent = data.error || data.reason || "Scan gagal";
        }
        setTimeout(resetToScanPrompt, 2000);
        return;
      }
      renderProfile(data, data.jenis);
    } catch (e) {
      if (els.statusCard) els.statusCard.textContent = "ERROR JARINGAN";
      console.error("[RFID] fetch error:", e);
      setTimeout(resetToScanPrompt, 2000);
    }
  }

  /**
   * Keyboard handler: akumulasi karakter sampai Enter ditekan,
   * lalu proses buffer sebagai UID.
   */
  function onKeyDown(e) {
    // Enter = akhir UID dari reader
    if (e.key === "Enter") {
      e.preventDefault();
      const uid = buffer.trim();
      buffer = "";
      if (uid) handleScan(uid);
      return;
    }
    // Abaikan tombol kontrol (Shift, Ctrl, dll) — hanya karakter printable
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length === 1) {
      buffer += e.key;
    }
  }

  // ---- init ----
  // Dynamic Running Kiosk Clock
  function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const clockEl = document.getElementById("kiosk-clock");
    if (clockEl) clockEl.textContent = `${hours}:${minutes}:${seconds}`;

    // update tanggal juga (opsional)
    const dateEl = document.getElementById("kiosk-date");
    if (dateEl) {
      const days = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
      const months = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
      const d = new Date();
      dateEl.textContent = `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }
  }

  // fokuskan input pertama kali & pasang listener
  focusInput();
  document.addEventListener("keydown", onKeyDown, true);

  setInterval(updateClock, 1000);
  updateClock();
})();
