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
    // Live feed container — di-populate oleh fetch /api/aktivitas-terakhir
    logStream:   document.getElementById("log-stream"),
    // Kapasitas workstation live — di-update oleh GET /api/kapasitas-hari-ini
    kapasitasUsed: document.getElementById("kapasitas-used"),
    kapasitasPct:  document.getElementById("kapasitas-pct"),
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
      // Live feed: langsung fetch ke /api/aktivitas-terakhir setelah scan
      // sukses agar item terbaru muncul immediately (bukan menunggu polling 10s).
      // Transaksi INSERT di backend sudah commit sebelum response dikirim,
      // jadi GET berikutnya sudah pasti melihat record baru.
      fetchRecentLogs();
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

  /**
   * Format epoch-ISO → "HH:MM" WITA (UTC+7).
   * Backend /api/aktivitas-terakhir kirimkan ISO string (UTC);
   * ditampilkan di zona lokal kiosk yang asumsinya WITA.
   * Bila beda 1-2 detik tidak masalah untuk live feed estetik.
   */
  function formatTimeWita(isoStr) {
    if (!isoStr) return "--:--";
    const d = new Date(isoStr);
    // +7 jam = 25200000 ms agar selalu WITA meski browser di zona lain.
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const wita = new Date(utc + (7 * 3600000));
    return wita.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  /**
   * "Baru Saja" bila ≤ 60s, "kk menit lalu" bila ≤ 1jam, selainnya jam:mens.
   * Untuk memberi jejak waktu relatif di live feed.
   */
  function relativeTime(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60)  return "Baru Saja";
    if (sec < 3600) return `${Math.floor(sec / 60)} menit lalu`;
    return "";
  }

  /**
   * Build satu item DOM dari sebuah log (object dari /api/aktivitas-terakhir).
   */
  function buildLogItem(row) {
    const isSiswa = row.tipe === "siswa";
    const isLatest = row.status_sync === 0; // item belum disinkron — highlight di kiri

    const badgeTxt = row.jenis === "masuk" ? "MASUK" : "KELUAR";
    // Warna tema: MASUK = hijau (emerald), KELUAR = merah (rose)
    const isMasuk = row.jenis === "masuk";
    const color = isMasuk ? "emerald" : "rose";

    // Sub-label: kelas/jabatan + NISN/NIP
    let subLabel = "";
    if (isSiswa) {
      subLabel = `${row.nama_kelas || "-"} \u2022 NISN: ${row.nisn || "-"}`;
    } else {
      subLabel = `${row.jabatan || "-"} \u2022 NIP: ${row.nip || "-"}`;
    }

    // Path foto: priority foto_path bila ada, else NISN/NIP + .jpg
    const idCol = isSiswa ? (row.nisn || row.nip) : (row.nip || row.nisn);
    const fotoPath = (row.foto_path
      ? (/\.(jpg|jpeg|png|webp)$/i.test(row.foto_path) ? row.foto_path : `${row.foto_path}.jpg`)
      : `${idCol}.jpg`);
    const fotoUrl = `./photos/${encodeURIComponent(fotoPath)}?t=${Date.now()}`;

    // Waktu relatif untuk highlight; absolut di kanan
    const rel = relativeTime(row.waktu_scan);

    const div = document.createElement("div");
    div.className = `rounded-lg p-space-sm flex items-center justify-between gap-space-sm shadow-xs transition-colors ${
      isLatest
        ? `bg-${color}-50/80 border border-${color}-200`
        : "bg-slate-50 border border-slate-200 hover:bg-slate-100/80"
    }`;
    div.innerHTML = `
      <div class="flex items-center gap-space-sm min-w-0">
        <div class="w-10 h-10 rounded-full overflow-hidden border-2 border-${color}-200 bg-slate-100 shrink-0 flex items-center justify-center">
          <img
            src="${fotoUrl}"
            alt="Foto ${row.nama || '-'}"
            class="w-full h-full object-cover object-top"
            onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjE0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjE0MCIgZmlsbD0iI2Y1ZmZmZiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNsaW5lPSJtaWQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2FucXMtc2VyaWYiIGZvbnRzaXplPSIxNCIgZmlsbD0iIzkyYzUzNCI+Tm9JbWFnZSw8L3RleHQ+PC9zdmc+';"
          />
        </div>
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-headline-md text-sm font-bold text-slate-900 truncate">${row.nama || "-"}</span>
            ${rel ? `<span class="font-label-code text-xs text-${color}-800 font-bold px-1.5 py-0.2 rounded bg-${color}-100 border border-${color}-300">${rel || badgeTxt}</span>` : ""}
          </div>
          <span class="font-label-code text-xs text-slate-600 font-semibold">${subLabel}</span>
        </div>
      </div>
      <div class="text-right shrink-0">
        <span class="font-headline-md text-sm ${isLatest ? `text-${color}-800` : "text-slate-900"} font-bold block">${badgeTxt}</span>
        <span class="font-label-code text-xs text-slate-600 font-semibold">${formatTimeWita(row.waktu_scan)}</span>
      </div>
    `;
    return div;
  }

  /**
   * Populate container #log-stream dengan snapshot 5 log terbaru.
   * List disusun reverse-chronological (terbaru di atas) untuk mencerminkan
   * urutan keluaran API (ORDER BY id DESC) — tidak perlu reverse di sini.
   */
  function renderLogStream(logs) {
    if (!els.logStream) return;
    els.logStream.innerHTML = "";
    if (!Array.isArray(logs) || logs.length === 0) {
      els.logStream.innerHTML =
        '<div class="font-label-code text-xs text-slate-500 text-center py-4">Belum ada log presensi</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const row of logs) frag.appendChild(buildLogItem(row));
    els.logStream.appendChild(frag);
  }

  /**
   * Fetch 5 log presensi terakhir dari /api/aktivitas-terakhir.
   * On error: kosongkan feed + tampilkan placeholder agar kiota tidak
   * menampilkan stale data.
   */
  async function fetchRecentLogs() {
    if (!els.logStream) return;
    try {
      const res = await fetch(`${API_BASE}/aktivitas-terakhir`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const logs = await res.json();
      renderLogStream(logs);
    } catch (e) {
      console.error("[RFID] aktivitas-terakhir fetch error:", e);
      els.logStream.innerHTML =
        '<div class="font-label-code text-xs text-rose-600 text-center py-4">Gagal memuat log presensi</div>';
    }
  }

  /**
   * Fetch kapasitas workstation: komputer yang sedang dipakai =
   * MASUK hari ini - KELUAR hari ini (hitungan DB, WITA).
   * Update angka di #kapasitas-used dan #kapasitas-pct secara live.
   */
  async function fetchKapasitas() {
    if (!els.kapasitasUsed && !els.kapasitasPct) return;
    try {
      const res = await fetch(`${API_BASE}/kapasitas-hari-ini`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const k = await res.json();
      const used = Number(k.used) || 0;
      const pct = Number(k.pct) || 0;
      if (els.kapasitasUsed) els.kapasitasUsed.textContent = used;
      if (els.kapasitasPct)  els.kapasitasPct.textContent = `${pct}%`;
    } catch (e) {
      console.error("[RFID] kapasitas-hari-ini fetch error:", e);
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

  // Live feed: log presensi terakhir — fetch sekali + polling tiap 10 detik
  fetchRecentLogs();
  setInterval(fetchRecentLogs, 10000);

  // Kapasitas workstation — fetch sekali + polling tiap 10 detik (sinkron dengan feed)
  fetchKapasitas();
  setInterval(fetchKapasitas, 10000);
})();
