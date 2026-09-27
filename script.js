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

  // ---- DOM target (id yang ditambahkan di index.html) ----
  const els = {
    statusCard:  document.getElementById("status-card"),
    statusSub:   document.getElementById("status-sub"),
    name:        document.getElementById("student-name"),
    kelas:       document.getElementById("student-kelas"),
    nisn:        document.getElementById("student-nisn"),
    badge:       document.getElementById("student-badge"),
    photo:       document.querySelector('img[alt="Photo Siswa"]'),
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
  function renderProfile(data) {
    const typeLabel = data.tipe === "siswa" ? "Siswa" : "Guru";
    const aktifLabel = data.status_aktif === "aktif" ? "Aktif" : "Nonaktif";

    if (els.statusCard) els.statusCard.textContent = "Selamat Datang Di LAB MAN 1";
    if (els.statusSub)  els.statusSub.textContent = `${typeLabel} — ${data.nama}`;
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
    if (els.photo && data.foto_path) {
      els.photo.src = `./photos/${data.foto_path}`;
      els.photo.alt = `${data.nama}`;
    }

    // auto-reset setelah ~2 detik agi siap amb scan berikutnya
    clearTimeout(window.__resetTimer);
    window.__resetTimer = setTimeout(resetToScanPrompt, 2000);
  }

  /**
   * Fetch lookup UID ke backend.
   */
  async function handleScan(uid) {
    try {
      const res = await fetch(`${API_BASE}/scan/${encodeURIComponent(uid)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (els.statusCard) els.statusCard.textContent = "KARTU TIDAK DITEMUKAN";
        if (els.statusSub)  els.statusSub.textContent = err.error || "Scan gagal";
        setTimeout(resetToScanPrompt, 2000);
        return;
      }
      const data = await res.json();
      renderProfile(data);
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
