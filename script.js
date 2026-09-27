(function () {
  // Dynamic Running Kiosk Clock
  function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const clockEl = document.getElementById("kiosk-clock");
    if (clockEl) {
      clockEl.textContent = hours + ":" + minutes + ":" + seconds;
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Interactive Demonstration Taps
  const btnSimulate = document.getElementById("btn-simulate-tap");
  if (btnSimulate) {
    btnSimulate.addEventListener("click", function () {
      const originalText = btnSimulate.innerHTML;
      btnSimulate.innerHTML =
        '<span class="material-symbols-outlined text-[18px] animate-spin">sync</span><span>Memindai...</span>';
      setTimeout(function () {
        btnSimulate.innerHTML =
          '<span class="material-symbols-outlined text-[18px]">check</span><span>Terverifikasi!</span>';
        setTimeout(function () {
          btnSimulate.innerHTML = originalText;
        }, 1800);
      }, 600);
    });
  }

  const btnQuota = document.getElementById("btn-check-quota");
  if (btnQuota) {
    btnQuota.addEventListener("click", function () {
      alert(
        "Status Kuota Lab Komputer:\n- Total Workstation: 40 Unit\n- Aktif: 24 Unit\n- Siap Pakai: 16 Unit\n- Perawatan: 0 Unit"
      );
    });
  }

  const btnHelp = document.getElementById("btn-lab-help");
  if (btnHelp) {
    btnHelp.addEventListener("click", function () {
      alert(
        "Panggilan bantuan teknisi lab telah dikirim ke UPT Laboratorium Komputer MAN 1 Kota Gorontalo (Ext. 104)."
      );
    });
  }
})();
