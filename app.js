// =========================================================================================
// 0. VARIABEL GLOBAL & FUNGSI RUPIAH FORMATTER (V30 ULTIMATE)
// =========================================================================================
let katalogBarang = []; 
let keranjang = []; 
let streamKamera = null; 
let kordinatGPS = "-"; 
let grafikPenjualan = null; 
let directQrCode = null; 
let isCameraRunning = false;
let deferredPrompt = null; 
let bluetoothDevice = null; 
let dataOpnameAktif = []; 
let targetScannerGlobal = 'cart';

// =========================================================
// FITUR OFFLINE-FIRST (ANTREAN TRANSAKSI TANPA INTERNET)
// =========================================================
let offlineQueue = JSON.parse(localStorage.getItem('pos_offline_queue')) || [];

async function syncOfflineDataQueue() {
    if(navigator.onLine && offlineQueue.length > 0) {
        showToast(`Menyinkronkan ${offlineQueue.length} data transaksi offline...`);
        let queueToProcess = [...offlineQueue];
        offlineQueue = []; // Kosongkan agar tidak dobel dikirim
        localStorage.removeItem('pos_offline_queue');
        
        for(let req of queueToProcess) {
            try { await fetch(API_URL, { method: 'POST', body: JSON.stringify(req) }); } 
            catch(e) { offlineQueue.push(req); } // Kembalikan ke antrean jika masih gagal
        }
        if(offlineQueue.length === 0) showToast("Sinkronisasi Offline Selesai!", "success");
        else localStorage.setItem('pos_offline_queue', JSON.stringify(offlineQueue));
    }
}
window.addEventListener('online', syncOfflineDataQueue);

// Fetch pengaman: Jika internet mati, lempar payload ke LocalStorage
async function safeFetch(payload) {
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
        return await res.json();
    } catch (e) {
        offlineQueue.push(payload);
        localStorage.setItem('pos_offline_queue', JSON.stringify(offlineQueue));
        showToast("Koneksi Terputus! Transaksi diamankan di Mode Offline.", "error");
        return { status: true, isOffline: true, noNota: "INV-OFL-" + new Date().getTime().toString().slice(-4) };
    }
}

// FORMAT RUPIAH SAAT MENGETIK
document.addEventListener('input', function (e) {
    if (e.target.classList.contains('input-rupiah')) {
        let value = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = value ? new Intl.NumberFormat('id-ID').format(value) : '';
    }
});

function cleanRupiah(str) {
    if(!str) return 0;
    return parseInt(str.toString().replace(/[^0-9]/g, '')) || 0;
}
const formatRp = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);

// FITUR KEAMANAN: Hashing SHA-256 Frontend untuk Karyawan Baru
async function hashSHA256(teks) {
    const msgBuffer = new TextEncoder().encode(teks);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// =========================================================================================
// 1. SISTEM NOTIFIKASI (TOAST) & AUDIO
// =========================================================================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer'); const toast = document.createElement('div');
    let bgColor = type === 'success' ? 'bg-slate-900 border-l-4 border-emerald-500' : 'bg-slate-900 border-l-4 border-rose-500';
    let icon = type === 'success' ? '<i class="fa-solid fa-circle-check text-emerald-500"></i>' : '<i class="fa-solid fa-circle-xmark text-rose-500"></i>';
    toast.className = `flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl text-white text-sm font-bold transform transition-all duration-300 translate-y-10 opacity-0 pointer-events-auto ${bgColor}`;
    toast.innerHTML = `${icon} <span>${message}</span>`; container.appendChild(toast);
    
    try {
        if(type === 'success') { let a = document.getElementById('audioSuccess'); if(a) { a.currentTime = 0; a.play().catch(e => console.log('Auto-play blocked')); } } 
        else { let a = document.getElementById('audioError'); if(a) { a.currentTime = 0; a.play().catch(e => console.log('Auto-play blocked')); } }
    } catch(e) {}

    setTimeout(() => { toast.classList.remove('translate-y-10', 'opacity-0'); toast.classList.add('translate-y-0', 'opacity-100'); }, 10); 
    setTimeout(() => { toast.classList.remove('translate-y-0', 'opacity-100'); toast.classList.add('translate-y-10', 'opacity-0'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// =========================================================================================
// 2. KONEKSI PRINTER
// =========================================================================================
async function koneksiBluetoothPrinter() {
    try {
        const btnTxt = document.getElementById('btStatusText'); btnTxt.innerText = "Mencari Printer...";
        const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455'] });
        const server = await device.gatt.connect(); bluetoothDevice = device; device.addEventListener('gattserverdisconnected', onPrinterDisconnected);
        updateBluetoothUI(true); showToast("Printer Bluetooth Terhubung!", "success");
    } catch (error) { updateBluetoothUI(false); showToast("Gagal konek Bluetooth! Pastikan printer menyala.", "error"); }
}
function onPrinterDisconnected() { bluetoothDevice = null; updateBluetoothUI(false); showToast("Koneksi Printer Terputus!", "error"); }
function updateBluetoothUI(isConnected) {
    const ind = document.getElementById('btStatusIndicator'); const txt = document.getElementById('btStatusText');
    if(isConnected) { ind.className = "w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"; txt.innerText = "Printer Ready"; } 
    else { ind.className = "w-3 h-3 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-pulse"; txt.innerText = "Printer Offline"; }
}

// =========================================================================================
// 3. TAB DINAMIS LAYANAN & LOGIKA PWA INSTALLER
// =========================================================================================
window.switchTabLayanan = function(type) {
    const btnSrv = document.getElementById('btnTabService'); const btnTT = document.getElementById('btnTabTT');
    const fSrv = document.getElementById('formService'); const fTT = document.getElementById('formTT');
    if(type === 'service') {
        fSrv.classList.remove('hidden'); fTT.classList.add('hidden');
        btnSrv.className = "flex-1 py-2.5 rounded-lg font-black text-sm bg-white shadow-sm text-indigo-600 transition-all uppercase tracking-widest";
        btnTT.className = "flex-1 py-2.5 rounded-lg font-bold text-sm text-gray-500 hover:text-gray-700 transition-all uppercase tracking-widest bg-transparent";
    } else {
        fTT.classList.remove('hidden'); fSrv.classList.add('hidden');
        btnTT.className = "flex-1 py-2.5 rounded-lg font-black text-sm bg-white shadow-sm text-indigo-600 transition-all uppercase tracking-widest";
        btnSrv.className = "flex-1 py-2.5 rounded-lg font-bold text-sm text-gray-500 hover:text-gray-700 transition-all uppercase tracking-widest bg-transparent";
    }
}

const installContainer = document.getElementById('installContainer'); 
if (installContainer && !window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone) {
    installContainer.classList.remove('hidden');
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; }); 

document.getElementById('installBtn')?.addEventListener('click', async () => { 
    if (deferredPrompt) { deferredPrompt.prompt(); const { outcome } = await deferredPrompt.userChoice; if (outcome === 'accepted') { installContainer.classList.add('hidden'); } deferredPrompt = null; } 
    else { showToast("Tekan menu browser (⋮) lalu pilih 'Tambahkan ke Layar Utama' (Add to Home Screen).", "success"); }
});

async function muatPengaturanToko() {
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_settings', token: localStorage.getItem('pos_token') }) }); const result = await res.json();
        if (result.status === true) {
            if (result.data.NAMA_TOKO) localStorage.setItem('pos_nama_toko', result.data.NAMA_TOKO);
            if (result.data.PESAN_STRUK) localStorage.setItem('pos_pesan_struk', result.data.PESAN_STRUK);
            if(document.getElementById('setNamaToko')) document.getElementById('setNamaToko').value = localStorage.getItem('pos_nama_toko') || "MAULANA PONSEL INDO";
            if(document.getElementById('setPesanStruk')) document.getElementById('setPesanStruk').value = localStorage.getItem('pos_pesan_struk') || "Barang yang dibeli tidak dapat ditukar.";
        }
    } catch (e) {}
}

// =========================================================================================
// 4. LOGIN, LOGOUT & MENU NAVIGASI (TAHAN REFRESH & INJEKSI EXCEL)
// =========================================================================================
function setDefaultDateFilters() {
    const d = new Date();
    const tgl = String(d.getDate()).padStart(2, '0');
    const bln = String(d.getMonth() + 1).padStart(2, '0');
    const thn = String(d.getFullYear());

    if (document.getElementById('filterTanggalLaporan')) document.getElementById('filterTanggalLaporan').value = tgl;
    if (document.getElementById('filterBulanLaporan')) document.getElementById('filterBulanLaporan').value = bln;
    if (document.getElementById('filterTahunLaporan')) document.getElementById('filterTahunLaporan').value = thn;

    if (document.getElementById('filterTglRiwayat')) document.getElementById('filterTglRiwayat').value = tgl;
    if (document.getElementById('filterBlnRiwayat')) document.getElementById('filterBlnRiwayat').value = bln;
    if (document.getElementById('filterThnRiwayat')) document.getElementById('filterThnRiwayat').value = thn;

    if (document.getElementById('filterBulanAbsen')) document.getElementById('filterBulanAbsen').value = bln;
    if (document.getElementById('filterTahunAbsen')) document.getElementById('filterTahunAbsen').value = thn;

    if (document.getElementById('filterBulanKas')) document.getElementById('filterBulanKas').value = bln;
    if (document.getElementById('filterTahunKas')) document.getElementById('filterTahunKas').value = thn;
    
    if (document.getElementById('filterBulanBarang')) document.getElementById('filterBulanBarang').value = bln;
    if (document.getElementById('filterTahunBarang')) document.getElementById('filterTahunBarang').value = thn;
}

function checkSession() {
    let token = localStorage.getItem('pos_token');
    if (token && token !== "undefined" && token !== "null" && token.trim() !== "") {
        document.getElementById('loginPage').classList.add('hidden'); 
        document.getElementById('dashboardPage').classList.remove('hidden');
        if(localStorage.getItem('pos_username')) document.getElementById('displayUsername').textContent = localStorage.getItem('pos_username');
        
        suntikTombolExcel(); syncOfflineDataQueue(); setDefaultDateFilters(); 
        renderSidebar(); muatKatalogBarang(); muatLaporan(); updateStatusAbsen(); muatPengaturanToko(); muatTabelAbsensi();
    } else { 
        localStorage.clear(); document.getElementById('dashboardPage').classList.add('hidden'); document.getElementById('loginPage').classList.remove('hidden'); 
    }
}

function suntikTombolExcel() {
    document.querySelectorAll('h3, h2').forEach(h => {
        let text = h.innerText;
        if(text.includes('Database Pelanggan') && !h.parentElement.innerHTML.includes('downloadExcel')) h.parentElement.innerHTML += `<button onclick="downloadExcel('tabelPelangganBody', 'Data_Pelanggan')" class="bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-600 transition-colors shadow-sm"><i class="fa-solid fa-file-excel mr-1"></i> Excel</button>`;
        if(text.includes('Daftar Pemasok') && !h.parentElement.innerHTML.includes('downloadExcel')) h.parentElement.innerHTML += `<button onclick="downloadExcel('tabelSupplierBody', 'Data_Supplier')" class="bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-600 transition-colors shadow-sm"><i class="fa-solid fa-file-excel mr-1"></i> Excel</button>`;
        if(text.includes('Riwayat Retur') && !h.parentElement.innerHTML.includes('downloadExcel')) h.parentElement.innerHTML += `<button onclick="downloadExcel('tabelReturBody', 'Riwayat_Retur')" class="bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-600 transition-colors shadow-sm"><i class="fa-solid fa-file-excel mr-1"></i> Excel</button>`;
        if(text.includes('Buku Piutang') && !h.parentElement.innerHTML.includes('downloadExcel')) h.parentElement.innerHTML += `<button onclick="downloadExcel('tabelPiutangBody', 'Buku_Piutang')" class="bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-600 transition-colors shadow-sm"><i class="fa-solid fa-file-excel mr-1"></i> Excel</button>`;
        if(text.includes('Arus Kas Keluar') && !h.parentElement.innerHTML.includes('downloadExcel')) h.parentElement.innerHTML += `<button onclick="downloadExcel('tabelKeuanganBody', 'Arus_Kas_Keluar')" class="bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-600 transition-colors shadow-sm"><i class="fa-solid fa-file-excel mr-1"></i> Excel</button>`;
        if(text.includes('Buku Kas Utama') && !h.parentElement.innerHTML.includes('downloadExcel')) h.parentElement.innerHTML += `<button onclick="downloadExcel('tabelKasUsahaBody', 'Buku_Kas_Utama')" class="bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-600 transition-colors shadow-sm"><i class="fa-solid fa-file-excel mr-1"></i> Excel</button>`;
        if(text.includes('Riwayat Pemasukan Aset') && !h.parentElement.innerHTML.includes('downloadExcel')) h.parentElement.innerHTML += `<button onclick="downloadExcel('tabelRestockBody', 'Riwayat_Restock')" class="bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-600 transition-colors shadow-sm"><i class="fa-solid fa-file-excel mr-1"></i> Excel</button>`;
    });
}

function renderSidebar() {
    const role = localStorage.getItem('pos_role') || ''; 
    const uname = localStorage.getItem('pos_username') || '';
    const isAdmin = role.toLowerCase().includes('admin') || role.toLowerCase().includes('owner') || uname.toLowerCase() === 'owner' || role === ''; 
    
    let nav = '';
    
    if(isAdmin || role.includes('POS') || role.includes('Laporan') || role.includes('Riwayat')) { 
        nav += `<div class="text-[10px] text-slate-500 font-bold uppercase mb-3 ml-2 mt-4 tracking-wider">Transaksi Utama</div>`; 
    }
    if(isAdmin || role.includes('POS')) nav += `<button onclick="switchMenu('menu-kasir', 'Kasir (Point of Sale)')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-kasir"><i class="fa-solid fa-cash-register text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Kasir (POS)</span></button>`;
    if(isAdmin || role.includes('Laporan')) nav += `<button onclick="switchMenu('menu-laporan', 'Dashboard Analitik')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-laporan"><i class="fa-solid fa-chart-pie text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Laporan (Owner)</span></button>`;
    if(isAdmin || role.includes('Riwayat')) nav += `<button onclick="switchMenu('menu-riwayat', 'Database Penjualan')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-riwayat"><i class="fa-solid fa-receipt text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Riwayat Transaksi</span></button>`;
    
    if(isAdmin || role.includes('Layanan') || role.includes('Retur')) { 
        nav += `<div class="text-[10px] text-slate-500 font-bold uppercase mb-3 ml-2 mt-6 tracking-wider">Layanan Terpadu</div>`; 
    }
    if(isAdmin || role.includes('Layanan')) nav += `<button onclick="switchMenu('menu-layanan', 'Pusat Layanan & Tukar Tambah')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-layanan"><i class="fa-solid fa-screwdriver-wrench text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Service & TT</span></button>`;
    if(isAdmin || role.includes('Retur')) nav += `<button onclick="switchMenu('menu-retur', 'Retur ke Supplier')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-retur"><i class="fa-solid fa-arrow-right-arrow-left text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Retur Supplier</span></button>`;
    
    if(isAdmin || role.includes('Barang') || role.includes('Restock') || role.includes('Opname')) { 
        nav += `<div class="text-[10px] text-slate-500 font-bold uppercase mb-3 ml-2 mt-6 tracking-wider">Inventory & Audit</div>`;
    }
    if(isAdmin || role.includes('Barang')) nav += `<button onclick="switchMenu('menu-barang', 'Master Data Barang')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-barang"><i class="fa-solid fa-boxes-stacked text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Katalog Stok</span></button>`;
    if(isAdmin || role.includes('Restock')) nav += `<button onclick="switchMenu('menu-restock', 'Mutasi Masuk Gudang')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-restock"><i class="fa-solid fa-truck-ramp-box text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Stok Masuk</span></button>`; 
    if(isAdmin || role.includes('Opname')) nav += `<button onclick="switchMenu('menu-opname', 'Audit Stok Opname (Tutup Toko)')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-opname"><i class="fa-solid fa-clipboard-check text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Stok Opname</span></button>`; 
    
    if(isAdmin || role.includes('CRM') || role.includes('Supplier')) { 
        nav += `<div class="text-[10px] text-slate-500 font-bold uppercase mb-3 ml-2 mt-6 tracking-wider">Relasi Bisnis</div>`; 
    }
    if(isAdmin || role.includes('CRM')) nav += `<button onclick="switchMenu('menu-pelanggan', 'Database Pelanggan')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-pelanggan"><i class="fa-solid fa-users-line text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Pelanggan</span></button>`;
    if(isAdmin || role.includes('Supplier')) nav += `<button onclick="switchMenu('menu-supplier', 'Data Pemasok')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-supplier"><i class="fa-solid fa-truck-field text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Supplier</span></button>`;
    
    if(isAdmin || role.includes('Kas') || role.includes('Pengeluaran') || role.includes('Piutang')) { 
        nav += `<div class="text-[10px] text-slate-500 font-bold uppercase mb-3 ml-2 mt-6 tracking-wider">Finance & Modal</div>`;
    }
    if(isAdmin || role.includes('Kas')) nav += `<button onclick="switchMenu('menu-kas', 'Buku Kas & Saldo Usaha (Modal)')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-kas"><i class="fa-solid fa-building-columns text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Buku Kas Utama</span></button>`;
    if(isAdmin || role.includes('Pengeluaran')) nav += `<button onclick="switchMenu('menu-keuangan', 'Pengeluaran Kas Operasional')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-keuangan"><i class="fa-solid fa-wallet text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Pengeluaran Kas</span></button>`;
    if(isAdmin || role.includes('Piutang')) nav += `<button onclick="switchMenu('menu-piutang', 'Buku Tagihan Piutang')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-piutang"><i class="fa-solid fa-hand-holding-dollar text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Buku Piutang</span></button>`;
    
    nav += `<div class="text-[10px] text-slate-500 font-bold uppercase mb-3 ml-2 mt-6 tracking-wider">Sistem & Bantuan</div><button onclick="switchMenu('menu-hrd', 'Mesin Absensi & Pengajuan HRD')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-hrd"><i class="fa-solid fa-fingerprint text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Absensi & HRD</span></button>`;
    if(isAdmin) nav += `<button onclick="switchMenu('menu-pengaturan', 'Konfigurasi Sistem')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-pengaturan"><i class="fa-solid fa-gear text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Pengaturan Admin</span></button>`;
    nav += `<button onclick="switchMenu('menu-panduan', 'Buku Panduan Sistem PWA')" class="nav-btn w-full flex items-center p-3 rounded-xl hover:bg-slate-800 text-slate-400 group transition-all" id="btn-menu-panduan"><i class="fa-solid fa-book-open text-lg mr-4 w-6 text-center"></i><span class="block font-medium">Buku Panduan</span></button>`;

    document.getElementById('mainSidebarNav').innerHTML = nav;
    
    let lastMenu = localStorage.getItem('pos_last_menu');
    let lastTitle = localStorage.getItem('pos_last_title') || 'Enterprise POS';
    
    if (lastMenu && document.getElementById(lastMenu)) {
        switchMenu(lastMenu, lastTitle);
    } else {
        if(isAdmin || role.includes('POS')) switchMenu('menu-kasir', 'Kasir (Point of Sale)'); else switchMenu('menu-hrd', 'Mesin Absensi & Pengajuan HRD');
    }
}

window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebarContainer'); const overlay = document.getElementById('overlaySidebar');
    if(!sidebar || !overlay) return;
    if (sidebar.classList.contains('-translate-x-full')) {
        sidebar.classList.remove('-translate-x-full'); overlay.classList.remove('hidden'); setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    } else {
        sidebar.classList.add('-translate-x-full'); overlay.classList.add('opacity-0'); setTimeout(() => overlay.classList.add('hidden'), 300);
    }
};

window.switchTabKatalog = function(statusTab) {
    document.querySelectorAll('.tab-katalog').forEach(btn => {
        btn.classList.remove('bg-indigo-600', 'text-white', 'shadow-lg');
        btn.classList.add('bg-white', 'text-gray-500', 'hover:bg-gray-50');
    });
    const activeBtn = document.getElementById(`tab-katalog-${statusTab}`);
    if(activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-500', 'hover:bg-gray-50');
        activeBtn.classList.add('bg-indigo-600', 'text-white', 'shadow-lg');
    }
    document.getElementById('statusFilterBarang').value = statusTab;
    muatTabelBarang();
};

function switchMenu(viewId, title) {
    if (window.innerWidth < 768) {
        document.getElementById('sidebarContainer')?.classList.add('-translate-x-full');
        const overlay = document.getElementById('overlaySidebar');
        if(overlay) { overlay.classList.add('opacity-0'); setTimeout(() => overlay.classList.add('hidden'), 300); }
    }
    
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden')); 
    document.querySelectorAll('.nav-btn').forEach(btn => { btn.classList.remove('bg-gradient-to-r', 'from-indigo-600', 'to-purple-600', 'text-white', 'shadow-lg', 'shadow-indigo-500/30'); btn.classList.add('text-slate-400', 'hover:bg-slate-800'); });
    const target = document.getElementById(viewId); if(target) target.classList.remove('hidden');
    const activeBtn = document.getElementById(`btn-${viewId}`); if(activeBtn) { activeBtn.classList.remove('text-slate-400', 'hover:bg-slate-800'); activeBtn.classList.add('bg-gradient-to-r', 'from-indigo-600', 'to-purple-600', 'text-white', 'shadow-lg', 'shadow-indigo-500/30'); }
    const pageTitle = document.getElementById('pageTitle'); if(pageTitle && title) pageTitle.innerText = title;

    localStorage.setItem('pos_last_menu', viewId);
    localStorage.setItem('pos_last_title', title);

    if(viewId === 'menu-barang') { if(!document.getElementById('statusFilterBarang').value) document.getElementById('statusFilterBarang').value = 'Tersedia'; muatTabelBarang(); }
    if(viewId === 'menu-laporan') muatLaporan();
    if(viewId === 'menu-pelanggan') window.muatTabelPelanggan();
    if(viewId === 'menu-supplier') window.muatTabelSupplier();
    if(viewId === 'menu-riwayat') window.muatTabelRiwayat();
    if(viewId === 'menu-layanan') window.muatTabelLayanan();
    if(viewId === 'menu-restock') window.muatTabelRestock();
    if(viewId === 'menu-retur') window.muatTabelRetur();
    if(viewId === 'menu-piutang') window.muatTabelPiutang();
    if(viewId === 'menu-keuangan') window.muatTabelKeuangan();
    if(viewId === 'menu-hrd') { mulaiKameraAbsensi(); muatTabelAbsensi(); } else matikanKameraAbsensi();
    if(viewId === 'menu-kas') { window.muatTabelKasUsaha(); kalkulasiKeuanganDashboard(); } 
    if(viewId === 'menu-opname') { window.muatTabelOpnameHistory(); } 
    if(viewId === 'menu-pengaturan') { if(window.muatTabelUser) window.muatTabelUser(); } 
}

document.getElementById('logoutBtn')?.addEventListener('click', function(e) { 
    e.preventDefault(); localStorage.clear(); showToast("Keluar sistem...", "success"); 
    if (newWorker && newWorker.state === 'installed') {
        newWorker.postMessage('SKIP_WAITING'); // Eksekusi update diam-diam saat logout
    } else {
        setTimeout(() => { window.location.reload(); }, 500); 
    }
});

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = document.getElementById('loginSubmitBtn'); btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mengecek...`; btn.disabled = true;
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'login', username: document.getElementById('username').value, password: document.getElementById('password').value }) });
        const result = await res.json();
        if (result.status === true) { 
            showToast("Akses Diterima!"); 
            let validToken = result.token || result.data?.token;
            localStorage.setItem('pos_token', validToken); 
            localStorage.setItem('pos_user_id', result.data.idUser); 
            localStorage.setItem('pos_username', result.data.username); 
            localStorage.setItem('pos_role', result.data.role); 
            setTimeout(() => { checkSession(); btn.innerHTML = `<i class="fa-solid fa-lock"></i> Masuk Sistem`; btn.disabled = false; document.getElementById('loginForm').reset(); }, 10); 
        } else { showToast(result.message, "error"); btn.innerHTML = `<i class="fa-solid fa-lock"></i> Masuk Sistem`; btn.disabled = false; }
    } catch (error) { 
        alert("🚨 RADAR ERROR MENANGKAP MASALAH:\n\n" + error.message + "\n\nCek file config.js atau lihat Console (F12) untuk detailnya.");
        btn.innerHTML = `<i class="fa-solid fa-lock"></i> Masuk Sistem`; btn.disabled = false; 
    }
});

// =========================================================================================
// 5. SCANNER BARCODE UNIVERSAL & PELACAKAN IMEI (REVISI KAMERA BESAR & TOMBOL MANUAL)
// =========================================================================================
function bukaScannerGlobal(target) { 
    targetScannerGlobal = target; const modal = document.getElementById('modalScanner'); modal.classList.remove('hidden'); 
    
    // Perbesar area modal scanner di layar
    const modalContent = document.getElementById('modalScannerContent');
    if(modalContent) { modalContent.classList.remove('max-w-md'); modalContent.classList.add('max-w-3xl'); modalContent.style.height = '85vh'; }
    
    setTimeout(() => { 
        modal.classList.remove('opacity-0'); 
        if (!directQrCode) directQrCode = new Html5Qrcode("reader");
        
        if (!isCameraRunning) {
            // Hilangkan kotak pembatas kecil (qrbox) agar layar full video
            directQrCode.start({ facingMode: "environment" }, { fps: 10, aspectRatio: 1.0 }, (text) => {
                if(isCameraRunning) { onScanSuccessGlobal(text); }
            }, undefined).then(() => { 
                isCameraRunning = true; 
                
                // Tambahkan tombol jepret manual jika belum ada
                const readerDiv = document.getElementById('reader');
                if(readerDiv && !document.getElementById('btnJepretManual')) {
                    const btnHtml = `<button id="btnJepretManual" onclick="alert('Tekan ini saat Barcode/IMEI sudah jelas di layar, lalu dekatkan sedikit lagi.')" class="absolute bottom-5 left-1/2 transform -translate-x-1/2 bg-indigo-600 text-white font-black px-6 py-3 rounded-full shadow-[0_0_20px_rgba(79,70,229,0.8)] border-2 border-white z-50 uppercase tracking-widest"><i class="fa-solid fa-camera mr-2"></i> Fokus & Scan!</button>`;
                    readerDiv.parentElement.insertAdjacentHTML('beforeend', btnHtml);
                }
            }).catch((err) => { showToast("Izin Kamera Ditolak / Tidak Ditemukan!", "error"); });
        }
    }, 100); 
}
function tutupScannerBarcode() { 
    const modal = document.getElementById('modalScanner'); modal.classList.add('opacity-0'); setTimeout(() => { modal.classList.add('hidden'); }, 300); 
    if (directQrCode && isCameraRunning) { directQrCode.stop().then(() => { isCameraRunning = false; }).catch(e=>{}); } 
    // Hapus tombol jepret saat modal ditutup
    const btnM = document.getElementById('btnJepretManual'); if(btnM) btnM.remove();
}
function onScanSuccessGlobal(decodedText) { 
    tutupScannerBarcode(); 
    showToast("Barcode terbaca!", "success");
    if (targetScannerGlobal === 'cart') {
        let item = katalogBarang.find(b => b.sku.toLowerCase() === decodedText.toLowerCase() || (b.imei && b.imei.toLowerCase() === decodedText.toLowerCase())); 
        if (item) tambahKeKeranjang(item.idBarang); else showToast(`Barang tidak ditemukan di katalog`, "error"); 
    } else {
        let el = document.getElementById(targetScannerGlobal);
        if (el) el.value = decodedText;
    }
}

// LOGIKA PELACAKAN IMEI DARI DATABASE
window.bukaModalLacak = () => { document.getElementById('modalLacakIMEI').classList.remove('hidden'); setTimeout(() => document.getElementById('modalLacakIMEI').classList.remove('opacity-0'), 10); };
window.tutupModalLacak = () => { document.getElementById('modalLacakIMEI').classList.add('opacity-0'); setTimeout(() => document.getElementById('modalLacakIMEI').classList.add('hidden'), 300); };
window.prosesLacakIMEI = async () => {
    let imei = document.getElementById('inputLacakIMEI').value.trim();
    if(!imei) return showToast("Masukkan IMEI terlebih dahulu!", "error");
    const btn = document.getElementById('btnLacakIMEI'); const ori = btn.innerHTML; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btn.disabled = true;
    const box = document.getElementById('hasilLacakIMEI'); box.innerHTML = `<div class="text-center text-indigo-500 mt-6"><i class="fa-solid fa-satellite-dish fa-spin text-3xl mb-2"></i><p class="text-[10px] font-black uppercase tracking-widest">Melacak ke Database Server...</p></div>`;
    
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'lacak_imei', token: localStorage.getItem('pos_token'), imei: imei }) });
        const result = await res.json();
        if(result.status) {
            box.innerHTML = '';
            if(result.data.length === 0) box.innerHTML = `<div class="text-center text-rose-400 mt-6"><i class="fa-solid fa-circle-xmark text-3xl mb-2"></i><p class="text-[10px] font-black uppercase tracking-widest">Data IMEI tidak pernah tercatat di toko ini.</p></div>`;
            else {
                result.data.forEach(log => {
                    let color = log.type.includes('Terjual') ? 'text-indigo-600 bg-indigo-50 border-indigo-200' : (log.type.includes('Gudang') ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-amber-600 bg-amber-50 border-amber-200');
                    box.innerHTML += `<div class="p-4 border rounded-2xl shadow-sm ${color} mb-2 relative overflow-hidden"><div class="flex justify-between items-center mb-1"><span class="text-[10px] font-black uppercase tracking-widest relative z-10">${log.type}</span><span class="text-[9px] font-bold opacity-70 relative z-10">${log.tgl}</span></div><p class="text-sm font-black relative z-10">${log.info}</p><p class="text-[10px] mt-1 font-semibold opacity-90 relative z-10">${log.detail}</p><i class="fa-solid fa-fingerprint absolute -right-3 -bottom-3 text-5xl opacity-10"></i></div>`;
                });
            }
        } else showToast(result.message, "error");
    } catch(e) { box.innerHTML = `<div class="text-center text-rose-500 font-bold text-xs mt-6">Gagal terhubung ke server.</div>`; } finally { btn.innerHTML = ori; btn.disabled = false; }
};

window.generateSKU = function() {
    const nama = document.getElementById('inputNama').value; 
    const kap = document.getElementById('inputKapasitas').value; 
    const warna = document.getElementById('inputWarna').value;
    const imei = document.getElementById('inputIMEI').value;
    
    const merekEl = document.getElementById('inputMerek');
    const garansiEl = document.getElementById('inputGaransiTipe');
    let merek = merekEl ? merekEl.value : "AND";
    let garansi = garansiEl ? garansiEl.value : "RSM";

    if(!nama) return showToast("Mohon isi Nama Produk terlebih dahulu!", "error");
    
    let namaBersih = nama.toUpperCase()
        .replace('IPHONE', '')
        .replace('APPLE', '')
        .replace('SAMSUNG', '')
        .replace('GALAXY', '')
        .replace('OPPO', '')
        .replace('VIVO', '')
        .replace('REALME', '')
        .replace('INFINIX', '')
        .replace('XIAOMI', '')
        .replace('POCO', '')
        .trim();
        
    namaBersih = namaBersih
        .replace(/PRO MAX/g, 'PM')
        .replace(/ULTRA/g, 'U')
        .replace(/RENO\s?/g, 'R')
        .replace(/REDMI\s?/g, 'RM')
        .replace(/NOTE\s?/g, 'N');
    
    let initNama = namaBersih.replace(/[^A-Z0-9]/g, '').substring(0, 6);
    if(!initNama) initNama = nama.replace(/[^A-Z0-9]/g, '').substring(0, 6);
    
    let initKap = kap ? kap.toUpperCase().replace(/GB/g, '').replace(/TB/g, 'T').replace(/[^A-Z0-9]/g, '') : '';
    let initWarna = warna ? warna.replace(/[^A-Za-z]/g, '').toUpperCase().substring(0,3) : '';
    
    let initIMEI = "";
    if (imei && imei.trim() !== "" && imei.trim() !== "-") {
        initIMEI = imei.replace(/[^0-9]/g, '').slice(-4);
        if(initIMEI.length < 4) initIMEI = Math.floor(1000 + Math.random() * 9000);
    } else {
        initIMEI = Math.floor(1000 + Math.random() * 9000); 
    }

    let skuArr = [merek];
    if(initNama) skuArr.push(initNama);
    if(initKap) skuArr.push(initKap);
    if(garansi && garansi !== "-") skuArr.push(garansi);
    if(initWarna) skuArr.push(initWarna);
    skuArr.push(initIMEI);

    document.getElementById('inputSKU').value = skuArr.join('-'); 
    showToast("SKU Pintar Klien Terbuat! ✨", "success");
}

function cetakLabelBarcode(sku, namaBarang, hargaJual, spek, imei) { 
    document.getElementById('lblTitle').textContent = namaBarang; 
    document.getElementById('lblPrice').textContent = formatRp(hargaJual); 
    
    let lblSpecs = document.getElementById('lblSpecs');
    if(!lblSpecs) {
        const svgBarcode = document.getElementById('lblBarcode');
        lblSpecs = document.createElement('div');
        lblSpecs.id = 'lblSpecs';
        svgBarcode.parentNode.insertBefore(lblSpecs, svgBarcode.nextSibling);
    }
    
    lblSpecs.style.cssText = "font-size: 9px; font-weight: 800; margin: 1px 0; color: #000; text-align: center; line-height: 1.1;";
    
    let spekClean = spek && spek.trim() !== '- -' && spek.trim() !== '-' ? `<div style="margin-top:1px;">${spek}</div>` : '';
    let imeiClean = imei && imei !== '-' ? `<div style="margin-top:1px;">IMEI: ${imei}</div>` : '';
    
    lblSpecs.innerHTML = `<div style="font-size: 9px; font-weight: 900; letter-spacing: 0.2px; margin-bottom: 1px;">${sku}</div>${spekClean}${imeiClean}`;

    JsBarcode("#lblBarcode", sku, { format: "CODE128", width: 1.2, height: 25, displayValue: false, margin: 0 }); 
    
    const printArea = document.getElementById('printLabelArea'); document.body.classList.add('print-barcode'); printArea.style.opacity = '1'; printArea.style.zIndex = '9999';
    setTimeout(() => { window.print(); document.body.classList.remove('print-barcode'); printArea.style.opacity = '0'; printArea.style.zIndex = '-999'; }, 500); 
}

// =========================================================================================
// 6. KASIR POS, DISKON/PPN & KATALOG
// =========================================================================================
async function muatKatalogBarang() { 
    const grid = document.getElementById('productGrid');
    if(grid) grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-24 text-indigo-400 opacity-80"><i class="fa-solid fa-circle-notch fa-spin text-5xl mb-4"></i><p class="font-black tracking-widest uppercase text-xs">Menyinkronkan Katalog...</p></div>`;
    try { 
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_barang', token: localStorage.getItem('pos_token') }) }); 
        const result = await res.json(); 
        if (result.status === true) { katalogBarang = result.data; renderKatalog(katalogBarang); updateDropdownSKU(katalogBarang); } 
        else { if(grid) grid.innerHTML = `<p class="col-span-full text-rose-500 text-center font-bold">Gagal: ${result.message}</p>`; }
    } catch (e) { 
        if(grid) grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-20 text-rose-500"><i class="fa-solid fa-satellite-dish text-4xl mb-4 opacity-50"></i><p class="font-black tracking-widest uppercase text-xs mb-4">Koneksi Lambat / Terputus.</p><button onclick="muatKatalogBarang()" class="bg-rose-50 text-rose-600 border border-rose-200 px-6 py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-rose-500 hover:text-white transition-colors shadow-sm"><i class="fa-solid fa-rotate mr-1"></i> Coba Lagi</button></div>`; 
    } 
}

function updateDropdownSKU(data) { 
    const cRst = document.getElementById('rstSKU'); const cRet = document.getElementById('returSKU'); const cTT = document.getElementById('ttSkuBaru');
    let optsTersedia = '<option value="">-- Pilih HP Baru --</option>'; data.forEach(b => { if(b.stok > 0) optsTersedia += `<option value="${b.sku}">${b.sku} - ${b.namaBarang} (Rp ${formatRp(b.hargaJual)})</option>`; }); if(cTT) cTT.innerHTML = optsTersedia;
    let optsRestock = '<option value="">-- Pilih Barang --</option>'; data.forEach(b => optsRestock += `<option value="${b.sku}">${b.sku} - ${b.namaBarang}</option>`); if(cRet) cRet.innerHTML = optsRestock;
    if(cRst) { cRst.innerHTML = optsRestock; cRst.onchange = function() { const brg = katalogBarang.find(b => b.sku === this.value); if(brg) { document.getElementById('rstHarga').value = ""; document.getElementById('rstQty').placeholder = `Sisa Stok: ${brg.stok} Pcs`; showToast(`Sisa stok di toko: ${brg.stok} Pcs`, 'success'); } else { document.getElementById('rstHarga').value = ""; document.getElementById('rstQty').placeholder = "Qty Masuk"; } }; }
}

function renderKatalog(data) { 
    const grid = document.getElementById('productGrid');
    const fragment = document.createDocumentFragment();
    
    data.forEach(item => { 
        let isHabis = item.stok <= 0; let textSpek = "";
        if(item.kapasitas !== '-' || item.warna !== '-') textSpek = `<p class="text-[10px] font-bold text-gray-500 mb-1 tracking-wider">${item.kapasitas !== '-' ? item.kapasitas : ''} ${item.warna !== '-' ? ' • '+item.warna : ''}</p>`;
        
        let div = document.createElement('div');
        div.className = `bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden ${isHabis?'opacity-50 grayscale':'cursor-pointer hover:-translate-y-2 hover:shadow-xl hover:shadow-indigo-500/10 hover:border-indigo-200'} transition-all duration-300 flex flex-col p-5 relative group`;
        if(!isHabis) div.onclick = () => tambahKeKeranjang(item.idBarang);
        
        div.innerHTML = `<div class="absolute top-4 right-4 ${isHabis?'bg-rose-100 text-rose-700':'bg-emerald-50 text-emerald-600'} text-[10px] px-3 py-1.5 rounded-full font-black shadow-sm z-10 border border-white tracking-widest">${isHabis?'HABIS':item.stok+' Pcs'}</div><div class="mt-4 text-left flex flex-col w-full h-full"><p class="text-[9px] text-gray-400 font-black uppercase tracking-widest mb-1 w-fit"><i class="fa-solid fa-barcode"></i> ${item.sku}</p><h4 class="font-black text-gray-800 text-lg leading-tight mb-1 w-full pr-10">${item.namaBarang}</h4>${textSpek}${item.imei !== '-' ? `<p class="text-[9px] text-gray-400 font-mono mt-1">IMEI: ${item.imei}</p>` : ''}<div class="mt-auto pt-4 flex justify-between items-end"><p class="text-indigo-600 font-black text-xl">${formatRp(item.hargaJual)}</p><div class="w-8 h-8 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors"><i class="fa-solid fa-plus"></i></div></div></div>`;
        fragment.appendChild(div);
    }); 
    
    grid.innerHTML = '';
    grid.appendChild(fragment);
}

document.getElementById('searchInput')?.addEventListener('input', (e) => { renderKatalog(katalogBarang.filter(b => b.namaBarang.toLowerCase().includes(e.target.value.toLowerCase()) || (b.imei && b.imei.toLowerCase().includes(e.target.value.toLowerCase())) || b.sku.toLowerCase().includes(e.target.value.toLowerCase()))); });
function toggleMobileCart() { document.getElementById('cartPanel').classList.toggle('translate-x-full'); }

function tambahKeKeranjang(id) { const brg = katalogBarang.find(b => b.idBarang === id); if (!brg) return; const idx = keranjang.findIndex(k => k.idBarang === id); if (idx > -1) { if(keranjang[idx].qty >= brg.stok) return showToast("Stok tidak cukup!", "error"); keranjang[idx].qty += 1; keranjang[idx].subtotal = keranjang[idx].qty * keranjang[idx].harga; } else { keranjang.push({ idBarang: brg.idBarang, namaBarang: brg.namaBarang, kapasitas: brg.kapasitas, warna: brg.warna, imei: brg.imei, harga: brg.hargaJual, qty: 1, subtotal: brg.hargaJual }); } renderKeranjang(); showToast(`${brg.namaBarang} ditambahkan.`); }
function hapusDariKeranjang(idx) { keranjang.splice(idx, 1); renderKeranjang(); }

window.hitungTotalCart = function() {
    let subtotal = keranjang.reduce((sum, i) => sum + i.subtotal, 0);
    let diskon = cleanRupiah(document.getElementById('inputDiskon')?.value) || 0;
    let ppn = parseFloat(document.getElementById('inputPPN')?.value) || 0;
    let dasarPPN = subtotal - diskon; if(dasarPPN < 0) dasarPPN = 0;
    let nilaiPPN = dasarPPN * (ppn / 100);
    let grandTotal = dasarPPN + nilaiPPN;
    document.getElementById('cartSubtotal').textContent = formatRp(subtotal);
    document.getElementById('cartTotal').textContent = formatRp(grandTotal);
    
    let uangDiterima = cleanRupiah(document.getElementById('inputUangPelanggan')?.value) || 0;
    let kembalian = uangDiterima - grandTotal;
    let kembalianEl = document.getElementById('cartKembalian');
    if (kembalianEl) {
        if (uangDiterima > 0 && kembalian >= 0) {
            kembalianEl.textContent = formatRp(kembalian);
            kembalianEl.classList.replace('text-rose-500', 'text-emerald-500');
        } else if (uangDiterima > 0 && kembalian < 0) {
            kembalianEl.textContent = "Uang Kurang!";
            kembalianEl.classList.replace('text-emerald-500', 'text-rose-500');
        } else {
            kembalianEl.textContent = "Rp 0";
            kembalianEl.classList.replace('text-rose-500', 'text-emerald-500');
        }
    }
}

function renderKeranjang() { 
    const list = document.getElementById('cartList'); let totalQty = 0; 
    if (keranjang.length === 0) { list.innerHTML = `<div class="text-center text-gray-400 mt-20 flex flex-col items-center"><div class="w-20 h-20 bg-gray-50 border border-gray-100 rounded-full flex items-center justify-center mb-4"><i class="fa-solid fa-basket-shopping text-3xl opacity-20"></i></div><p class="text-sm font-bold uppercase tracking-widest">Keranjang Kosong</p></div>`; } 
    else { 
        list.innerHTML = ''; 
        keranjang.forEach((item, index) => { 
            totalQty += item.qty; 
            list.innerHTML += `<div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mb-3 flex justify-between items-center group hover:border-indigo-200 transition-colors gap-2"><div class="flex-1 min-w-0 pr-2"><h5 class="text-sm font-extrabold text-gray-800 leading-tight truncate" title="${item.namaBarang}">${item.namaBarang}</h5><p class="text-[9px] font-bold text-gray-500 mt-1 truncate" title="${item.kapasitas||'-'} • ${item.warna||'-'} | IMEI: ${item.imei||'-'}">${item.kapasitas||'-'} • ${item.warna||'-'} | IMEI: ${item.imei||'-'}</p><div class="text-xs text-indigo-600 font-black mt-2 bg-indigo-50 w-fit px-2.5 py-1 rounded-md tracking-wider">${formatRp(item.harga)} <span class="text-gray-400 font-bold ml-1">x ${item.qty}</span></div></div><div class="text-right flex flex-col items-end shrink-0"><div class="font-black text-gray-800 text-sm mb-2">${formatRp(item.subtotal)}</div><button onclick="hapusDariKeranjang(${index})" class="text-rose-500 bg-rose-50 hover:bg-rose-500 hover:text-white transition-colors px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-rose-100 shadow-sm">Hapus</button></div></div>`; 
        }); 
    } 
    document.getElementById('cartBadge').textContent = `${totalQty} Item`; document.getElementById('mobileCartBadge').textContent = totalQty; hitungTotalCart(); 
}

let isCheckoutProcessing = false;
document.getElementById('btnCheckout')?.addEventListener('click', async () => { 
    if (keranjang.length === 0 || isCheckoutProcessing) return; 
    isCheckoutProcessing = true;
    const pel = document.getElementById('inputPelanggan').value.trim() || "Umum"; const garansi = document.getElementById('inputGaransi').value.trim() || "-"; const metode = document.getElementById('inputPembayaran').value; 
    const btn = document.getElementById('btnCheckout'); btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses...`; btn.disabled = true; 
    let subtotal = keranjang.reduce((sum, i) => sum + i.subtotal, 0); 
    let diskon = cleanRupiah(document.getElementById('inputDiskon')?.value) || 0; let ppn = parseFloat(document.getElementById('inputPPN')?.value) || 0;
    let dasarPPN = subtotal - diskon; if(dasarPPN < 0) dasarPPN = 0; let grandTotal = dasarPPN + (dasarPPN * (ppn / 100));

    let uangDiterima = cleanRupiah(document.getElementById('inputUangPelanggan')?.value) || 0;
    if(metode === "Cash" && uangDiterima > 0 && uangDiterima < grandTotal) {
        showToast("Uang tunai kurang dari Total Bayar!", "error");
        btn.innerHTML = `<i class="fa-solid fa-print text-xl"></i> BAYAR & CETAK STRUK`; btn.disabled = false;
        return;
    }
    let kembalian = (metode === "Cash" && uangDiterima > grandTotal) ? (uangDiterima - grandTotal) : 0;
    let totalBayarMasuk = (metode === "Cash" && uangDiterima > 0) ? uangDiterima : grandTotal;

    try { 
        const payload = { idCustomer: pel, idUser: localStorage.getItem('pos_username') || "Admin", subtotal: subtotal, diskon: diskon, ppn: ppn, grandTotal: grandTotal, metodePembayaran: metode, totalBayar: totalBayarMasuk, kembalian: kembalian, keranjang: keranjang };
        
        const result = await safeFetch({ action: 'proses_transaksi', token: localStorage.getItem('pos_token'), payload: payload }, "Transaksi Jual"); 
        
        if (result.status === true || result.isOffline) { 
            showToast("Transaksi Berhasil!", "success"); cetakUlang(result.noNota || "INV-OFFLINE", new Date().toLocaleString('id-ID'), pel, subtotal, keranjang, garansi, metode, diskon, ppn, grandTotal, totalBayarMasuk, kembalian); 
            setTimeout(() => { keranjang = []; document.getElementById('inputPelanggan').value = ""; document.getElementById('inputGaransi').value = ""; document.getElementById('inputPembayaran').value = "Cash"; document.getElementById('inputDiskon').value = ""; document.getElementById('inputPPN').value = ""; if(document.getElementById('inputUangPelanggan')) document.getElementById('inputUangPelanggan').value = ""; renderKeranjang(); muatKatalogBarang(); muatLaporan(); window.muatTabelKasUsaha(); }, 10); 
        } else showToast(result.message, "error"); 
    } catch (e) { showToast("Gagal memproses", "error"); } finally { isCheckoutProcessing = false; btn.innerHTML = `<i class="fa-solid fa-print text-xl"></i> BAYAR & CETAK STRUK`; btn.disabled = false; } 
});

function cetakUlang(nota, tgl, pel, subtotal, customKeranjang = null, manualGaransi = null, metodePrint = "Cash", diskon = 0, ppn = 0, grandTotal = 0, uangBayar = 0, kembalian = 0) { 
    let keranjangData = customKeranjang || [{ namaBarang: "CETAK ULANG", qty: 1, harga: subtotal, subtotal: subtotal }]; 
    const toko = localStorage.getItem('pos_nama_toko') || "MAULANA PONSEL INDO"; const pesan = localStorage.getItem('pos_pesan_struk') || "Barang yang dibeli tidak dapat ditukar."; const garansiText = manualGaransi && manualGaransi !== "-" ? `<p style="margin:5px 0 0 0; font-size:10px; font-weight:bold;">Masa Garansi: ${manualGaransi}</p>` : ""; 
    const printArea = document.getElementById('printArea'); 
    let finalTotal = grandTotal || subtotal;
    let html = `<div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:5px;margin-bottom:5px;"><h3 style="margin:0;font-size:16px;">${toko}</h3><p style="margin:0;font-size:10px;">Tgl: ${tgl}</p><p style="margin:0;font-size:10px;">Nota: ${nota} | Pel: ${pel}</p></div><table style="width:100%;font-size:11px;">`; 
    keranjangData.forEach(i => { 
        let detailSpek = ""; 
        if(i.kapasitas && i.kapasitas !== '-') detailSpek += `${i.kapasitas} `; 
        if(i.warna && i.warna !== '-') detailSpek += `${i.warna} `; 
        if(i.imei && i.imei !== '-') detailSpek += `(IMEI: ${i.imei})`; 
        html += `<tr><td colspan="2"><b>${i.namaBarang}</b><br><span style="font-size:9px; color:#555;">${detailSpek}</span></td></tr><tr><td style="padding-bottom:5px;">${i.qty} x ${formatRp(i.harga)}</td><td style="text-align:right; padding-bottom:5px;">${formatRp(i.subtotal)}</td></tr>`; 
    }); 
    html += `</table><div style="border-top:1px dashed #000;margin-top:5px;font-size:11px;">`;
    html += `<div style="display:flex; justify-content:space-between;"><span>Subtotal:</span><span>${formatRp(subtotal)}</span></div>`;
    if(diskon > 0) html += `<div style="display:flex; justify-content:space-between;"><span>Diskon:</span><span>-${formatRp(diskon)}</span></div>`;
    if(ppn > 0) html += `<div style="display:flex; justify-content:space-between;"><span>PPN (${ppn}%):</span><span>+${formatRp((subtotal-diskon)*ppn/100)}</span></div>`;
    html += `<div style="display:flex; justify-content:space-between; font-weight:bold; font-size:12px; margin-top:3px; border-top:1px solid #000; padding-top:3px;"><span>Total:</span><span>${formatRp(finalTotal)}</span></div>`;
    
    if (uangBayar > 0 && metodePrint === "Cash") {
        html += `<div style="display:flex; justify-content:space-between; font-size:11px; margin-top:2px;"><span>Tunai:</span><span>${formatRp(uangBayar)}</span></div>`;
        if (kembalian > 0) {
            html += `<div style="display:flex; justify-content:space-between; font-size:11px;"><span>Kembali:</span><span>${formatRp(kembalian)}</span></div>`;
        }
    }
    
    html += `</div><div style="text-align:right; font-size:10px; margin-top:3px;">Pembayaran: ${metodePrint}</div>${garansiText}<div style="text-align:center;margin-top:10px;font-size:10px;">${pesan}</div>`; 
    printArea.innerHTML = html; document.body.classList.add('print-nota'); printArea.style.opacity = '1'; printArea.style.zIndex = '9999';
    setTimeout(() => { window.print(); document.body.classList.remove('print-nota'); printArea.style.opacity = '0'; printArea.style.zIndex = '-999'; }, 500); 
}

function renderSupplier(data, tbody) { 
    tbody.innerHTML = ''; 
    const dataListPiu = document.getElementById('listPiutangKontak');
    const dataListSup = document.getElementById('listSupplier');
    const selReturSup = document.getElementById('returSupplier');
    if(dataListSup) dataListSup.innerHTML = '';
    if(selReturSup) selReturSup.innerHTML = '<option value="">-- Pilih Supplier --</option>';
    if(data.length===0) return tbody.innerHTML = `<tr><td colspan="3" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Data Kosong</td></tr>`; 
    data.forEach(item => {
        let wa = String(item[3]||'').replace(/\D/g, ''); if(wa.startsWith('0')) wa = '62' + wa.substring(1); 
        let waLink = wa ? `<a href="https://wa.me/${wa}" target="_blank" class="text-emerald-500 hover:text-emerald-700 font-bold transition-colors inline-flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100"><i class="fa-brands fa-whatsapp"></i> ${item[3]}</a>` : '-';
        tbody.innerHTML += `<tr class="hover:bg-slate-50 border-b border-gray-50"><td class="py-4 px-6 font-black text-indigo-700">${item[1]||'-'}</td><td class="py-4 px-6 font-semibold text-gray-800">${item[2]||'-'}<br><span class="text-[10px] text-gray-500 font-mono mt-1 inline-block">${waLink}</span></td><td class="py-4 px-6"><span class="bg-gray-100 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-600">${item[8]||'-'}</span></td></tr>`;
        if(dataListPiu) dataListPiu.innerHTML += `<option value="${item[1]||'-'}">`;
        if(dataListSup) dataListSup.innerHTML += `<option value="${item[1]||'-'}">`;
        if(selReturSup) selReturSup.innerHTML += `<option value="${item[1]||'-'}">${item[1]||'-'}</option>`;
    }); 
}

// MODAL KONFIRMASI CUSTOM (MENCEGAH LINK DOMAIN BOCOR)
window.customConfirm = function(msg, callback) {
    const modalHtml = `
    <div id="customConfirmModal" class="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 opacity-0 transition-opacity duration-300">
        <div class="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 transform scale-95 transition-transform duration-300 text-center">
            <div class="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-5 text-rose-500 text-4xl">
                <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <h3 class="font-black text-xl text-gray-800 mb-2">Konfirmasi</h3>
            <p class="text-sm text-gray-500 font-medium mb-8 leading-relaxed">${msg}</p>
            <div class="flex gap-3">
                <button onclick="tutupCustomConfirm()" class="flex-1 py-3.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors uppercase tracking-widest text-[10px]">Batal</button>
                <button id="btnConfirmYes" class="flex-1 py-3.5 rounded-xl font-black text-white bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/30 transition-colors uppercase tracking-widest text-[10px]">Ya, Lanjutkan</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const m = document.getElementById('customConfirmModal');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
    
    document.getElementById('btnConfirmYes').onclick = () => { tutupCustomConfirm(); callback(); };
};
window.tutupCustomConfirm = function() {
    const m = document.getElementById('customConfirmModal');
    if(m) { m.classList.add('opacity-0'); m.children[0].classList.add('scale-95'); setTimeout(() => m.remove(), 300); }
};

window.hapusBarangDariKatalog = function(id) {
    customConfirm("Yakin ingin mengarsipkan barang ini dari etalase? <br>(Histori lama tetap aman)", () => {
        kirimUpdate('Barang', id, 'Dihapus');
        setTimeout(() => { muatTabelBarang(); muatKatalogBarang(); }, 1500);
    });
}

window.cetakLabelService = function(nota, nama, tipe, imei, kendala) {
    let tgl = new Date().toLocaleString('id-ID');
    let html = `<div class="service-ticket"><b>TANDA TERIMA SERVICE</b><br>No: ${nota}<br>Tgl: ${tgl}<br>Pelanggan: ${nama}<br>Tipe: ${tipe}<br>IMEI: ${imei}<br>Kendala: ${kendala}</div><div class="service-ticket"><b>LABEL TEKNISI (TEMPEL)</b><br>No: ${nota}<br>Tgl: ${tgl}<br>Tipe: ${tipe}<br>IMEI: ${imei}<br>Kendala: ${kendala}</div>`;
    const printArea = document.getElementById('printLabelServiceArea'); printArea.innerHTML = html; document.body.classList.add('print-service'); printArea.style.opacity = '1'; printArea.style.zIndex = '9999';
    setTimeout(() => { window.print(); document.body.classList.remove('print-service'); printArea.style.opacity = '0'; printArea.style.zIndex = '-999'; }, 500); 
}

// =========================================================================================
// 7. TABEL GENERIK (RENDERER DATA)
// =========================================================================================
async function muatTabelGenerik(sheetName, tbodyId, renderFunction) { const tbody = document.getElementById(tbodyId); if(!tbody) return; tbody.innerHTML = `<tr><td colspan="10" class="text-center py-10 font-bold text-indigo-500 uppercase tracking-widest text-xs">Loading Data...</td></tr>`; try { const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_master', token: localStorage.getItem('pos_token'), sheetName: sheetName }) }); const result = await res.json(); if (result.status === true) { let data = result.data || []; if(!['Customer', 'Supplier'].includes(sheetName)) data = data.reverse(); renderFunction(data.slice(0, 100), tbody); } else { tbody.innerHTML = `<tr><td colspan="10" class="text-center py-10 text-rose-500 font-bold uppercase tracking-widest text-xs">ERROR SERVER: ${result.message}</td></tr>`; showToast(result.message, "error"); } } catch (e) { tbody.innerHTML = `<tr><td colspan="10" class="text-center py-10 text-rose-500 font-bold uppercase tracking-widest text-xs">Gagal Terhubung ke Server (Cek Koneksi / URL)</td></tr>`; } }

function renderPelanggan(data, tbody) { 
    tbody.innerHTML = ''; 
    const dataListPOS = document.getElementById('listPelangganPOS');
    const dataListPiu = document.getElementById('listPiutangKontak');
    if(dataListPOS) dataListPOS.innerHTML = '<option value="Umum">';
    if(dataListPiu) dataListPiu.innerHTML = '';
    if(data.length===0) return tbody.innerHTML = `<tr><td colspan="3" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Data Kosong</td></tr>`; 
    data.forEach(item => {
        let nama = item[1] || '-';
        let wa = String(item[2]||'').replace(/\D/g, ''); if(wa.startsWith('0')) wa = '62' + wa.substring(1); 
        let waLink = wa ? `<a href="https://wa.me/${wa}" target="_blank" class="text-emerald-500 hover:text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-2 border border-emerald-100 shadow-sm"><i class="fa-brands fa-whatsapp text-sm"></i> ${item[2]}</a>` : '-';
        tbody.innerHTML += `<tr class="hover:bg-slate-50"><td class="py-4 px-6 font-bold">${nama}</td><td class="py-4 px-6 font-semibold">${waLink}</td><td class="py-4 px-6 text-gray-500 text-xs">${item[4]||'-'}</td></tr>`;
        if(dataListPOS) dataListPOS.innerHTML += `<option value="${nama}">`;
        if(dataListPiu) dataListPiu.innerHTML += `<option value="${nama}">`;
    }); 
}

function renderRiwayat(data, tbody) { 
    const fragment = document.createDocumentFragment();
    if(data.length===0) { tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Pilih Tanggal & Klik Filter</td></tr>`; return; } 
    
    let htmlString = '';
    data.forEach(item => {
        htmlString += `
        <tr class="hover:bg-slate-50 border-b border-gray-100">
            <td class="py-5 px-6 text-[10px] font-bold text-gray-500 tracking-wider">${formatTanggalWIB(item[13] || item[2])}</td>
            <td class="py-5 px-6 font-black">${item[1]}</td>
            <td class="py-5 px-6 font-semibold text-gray-600">${item[3]}</td>
            <td class="py-5 px-6 font-bold text-gray-500 text-xs uppercase"><span class="bg-gray-100 px-2 py-1 rounded">${item[9] || 'Cash'}</span></td>
            <td class="py-5 px-6 text-right font-black text-indigo-600 text-lg">${formatRp(item[10])}</td>
            <td class="py-5 px-6 text-center">
                <div class="flex justify-center gap-2">
                    <button onclick="lihatDetailTransaksi('${item[0]}', '${item[1]}')" class="bg-indigo-50 text-indigo-600 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 hover:text-white transition-colors shadow-sm"><i class="fa-solid fa-eye"></i> Rincian</button>
                    <button onclick="cetakUlang('${item[1]}','${item[2]}','${item[3]}',${item[10]},null,null,'${item[9]||'Cash'}')" class="bg-white border border-gray-200 text-gray-600 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 transition-colors shadow-sm"><i class="fa-solid fa-print"></i> Struk</button>
                </div>
            </td>
        </tr>`; 
    }); 
    tbody.innerHTML = htmlString;
}

window.muatTabelRiwayat = async () => {
    const tbody = document.getElementById('tabelRiwayatBody'); if(!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 font-bold text-indigo-500 uppercase tracking-widest text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat Riwayat...</td></tr>`;
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_master', token: localStorage.getItem('pos_token'), sheetName: 'Transaksi (Header)' }) });
        const result = await res.json();
        if(result.status) {
            let rawData = result.data.reverse();
            let fTgl = document.getElementById('filterTglRiwayat') ? document.getElementById('filterTglRiwayat').value : 'Semua';
            let fBln = document.getElementById('filterBlnRiwayat') ? document.getElementById('filterBlnRiwayat').value : 'Semua';
            let fThn = document.getElementById('filterThnRiwayat') ? document.getElementById('filterThnRiwayat').value : 'Semua';

            let filteredData = rawData.filter(item => {
                let dtInfo = null; let s = String(item[13] || item[2]);
                let dObj = new Date(s);
                if(!isNaN(dObj.getTime()) && s.includes('T')) dtInfo = { y: String(dObj.getFullYear()), m: String(dObj.getMonth()+1).padStart(2,'0'), d: String(dObj.getDate()).padStart(2,'0') };
                else if(s.includes('-')) { let p = s.split('T')[0].split('-'); if(p.length===3) dtInfo = { y: p[0].length===4?p[0]:p[2], m: p[1].padStart(2,'0'), d: p[0].length===4?p[2].substring(0,2):p[0] }; }
                else if(s.includes('/')) { let p = s.split(' ')[0].split('/'); if(p.length===3) dtInfo = { y: p[2].length===4?p[2]:p[0], m: p[1].padStart(2,'0'), d: p[2].length===4?p[0].padStart(2,'0'):p[2] }; }
                
                if(!dtInfo) return true;
                let matchTgl = (fTgl === 'Semua') || (dtInfo.d === fTgl);
                let matchBulan = (fBln === 'Semua') || (dtInfo.m === fBln);
                let matchTahun = (fThn === 'Semua') || (dtInfo.y === fThn);
                return matchTgl && matchBulan && matchTahun;
            });
            renderRiwayat(filteredData.slice(0, 500), tbody);
        }
    } catch(e) { tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-rose-500 font-bold">Gagal memuat</td></tr>`; }
}

window.lihatDetailTransaksi = async function(idTrx, nota) {
    const modal = document.getElementById('modalDetailTransaksi');
    const tbody = document.getElementById('tabelDetailTransaksiBody');
    document.getElementById('detailNotaTitle').innerText = nota;
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10"><i class="fa-solid fa-spinner fa-spin text-indigo-500 text-2xl"></i></td></tr>`;
    modal.classList.remove('hidden'); setTimeout(() => modal.classList.remove('opacity-0'), 10);
    
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_master', token: localStorage.getItem('pos_token'), sheetName: 'Detail_Transaksi' }) });
        const result = await res.json();
        if(result.status) {
            let details = result.data.filter(d => d[1] === idTrx);
            let htmlString = '';
            if(details.length === 0) tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Data rincian tidak ditemukan.</td></tr>`;
            details.forEach(item => {
                let namaItem = item[2]; 
                let brg = katalogBarang.find(b => b.idBarang === item[2] || b.sku === item[2]);
                if (brg) namaItem = brg.namaBarang;
                
                htmlString += `
                <tr class="hover:bg-slate-50">
                    <td class="py-4 px-5 font-bold text-gray-800">${namaItem}<br><span class="text-[10px] text-gray-400 font-mono tracking-widest mt-1 block">${item[3] !== '-' ? 'IMEI: '+item[3] : ''}</span></td>
                    <td class="py-4 px-5 text-center font-black bg-gray-50/50">${item[4]}</td>
                    <td class="py-4 px-5 text-right font-semibold text-gray-600">${formatRp(item[5])}</td>
                    <td class="py-4 px-5 text-right font-black text-indigo-600">${formatRp(item[7])}</td>
                </tr>`;
            });
            if(details.length > 0) tbody.innerHTML = htmlString;
        }
    } catch(e) { tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-rose-500 font-bold uppercase tracking-widest text-xs">Gagal terhubung ke server</td></tr>`; }
}

window.tutupDetailTransaksi = function() {
    const modal = document.getElementById('modalDetailTransaksi');
    modal.classList.add('opacity-0'); setTimeout(() => modal.classList.add('hidden'), 300);
}

function renderLayanan(data, tbody) { 
    if(data.length===0) return tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Data Kosong</td></tr>`; 
    let htmlString = '';
    data.forEach(item => { let isDone = item[6] === 'Selesai' || item[6] === 'Selesai (TT)'; htmlString += `<tr class="hover:bg-slate-50 border-b border-gray-100"><td class="py-4 px-6 text-xs font-bold text-gray-500">${item[7]}</td><td class="py-4 px-6 font-black">${item[1]}<br><span class="text-[10px] text-gray-500 font-bold bg-gray-100 px-2 py-0.5 rounded mt-1 inline-block">${item[2]}</span></td><td class="py-4 px-6 font-medium text-gray-600">${item[3]}</td><td class="py-4 px-6"><span class="px-3 py-1.5 rounded-lg text-[10px] font-black tracking-widest uppercase shadow-sm border ${isDone?'bg-emerald-50 border-emerald-100 text-emerald-600':'bg-amber-50 border-amber-100 text-amber-600'}">${item[6]}</span></td><td class="py-4 px-6 text-center"><button onclick="bukaModalEdit('Layanan', '${item[0]}')" class="text-indigo-500 bg-indigo-50 w-10 h-10 rounded-xl hover:bg-indigo-500 hover:text-white transition-colors"><i class="fa-solid fa-pen-to-square"></i></button></td></tr>`; }); 
    tbody.innerHTML = htmlString;
}

function renderRestock(data, tbody) { 
    let filtered = data.filter(i => String(i[2]).toLowerCase().includes("masuk") || String(i[0]).includes("IN-")); if(filtered.length===0) return tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Data Kosong</td></tr>`; 
    let htmlString = '';
    filtered.forEach(item => htmlString += `<tr class="hover:bg-slate-50 border-b border-gray-50"><td class="py-4 px-6 text-xs font-bold text-gray-500">${item[1]}</td><td class="py-4 px-6 font-black text-gray-800">${item[3]}</td><td class="py-4 px-6 text-center"><span class="font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">+${item[4]}</span></td><td class="py-4 px-6 text-xs font-bold text-gray-600 uppercase">${item[6]}</td></tr>`); 
    tbody.innerHTML = htmlString;
}

function renderRetur(data, tbody) { 
    if (data.length === 0) return tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Belum Ada Riwayat Retur</td></tr>`; 
    let htmlString = '';
    data.forEach(item => {
        let isRefund = String(item[5]).includes("Refund");
        let badgeWarna = isRefund ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-amber-50 text-amber-600 border-amber-200";
        htmlString += `
        <tr class="hover:bg-slate-50 border-b border-gray-50">
            <td class="py-4 px-6 text-xs font-bold text-gray-500">${item[1]}</td>
            <td class="py-4 px-6 font-black text-indigo-700">${item[2]}</td>
            <td class="py-4 px-6 font-bold text-gray-800">${item[3]}</td>
            <td class="py-4 px-6"><span class="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border ${badgeWarna}">${item[5]}</span><br><span class="text-[10px] text-gray-500 font-medium mt-1.5 inline-block"><i class="fa-solid fa-quote-left mr-1"></i> ${item[4]}</span></td>
        </tr>`;
    }); 
    tbody.innerHTML = htmlString;
}

function renderPiutang(data, tbody) { 
    if(data.length===0) return tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Data Kosong</td></tr>`; 
    let htmlString = '';
    data.forEach(item => { 
        let isLunas = item[7] === 'Lunas'; 
        let jtFull = String(item[3]); let jt = jtFull.includes('T') ? jtFull.split('T')[0] : jtFull; 
        let tglCatat = formatTanggalWIB(item[5]) || item[5]; 
        
        htmlString += `
        <tr class="hover:bg-slate-50 border-b border-gray-50">
            <td class="py-4 px-6 font-black text-gray-800">${item[1]}<br><span class="text-[9px] text-gray-500 font-bold uppercase tracking-widest block mt-1 leading-tight">${item[4]}</span></td>
            <td class="py-4 px-6 text-right font-black text-rose-500 text-lg">${formatRp(item[2])}</td>
            <td class="py-4 px-6 text-[10px] font-bold text-gray-400 tracking-wider">${tglCatat}</td>
            <td class="py-4 px-6 text-[11px] font-black text-rose-500 tracking-wider bg-rose-50/30">${jt}</td>
            <td class="py-4 px-6 text-center"><span class="px-3 py-1.5 rounded-lg text-[10px] font-black tracking-widest uppercase border ${isLunas?'bg-emerald-50 border-emerald-100 text-emerald-600':'bg-amber-50 border-amber-100 text-amber-600'}">${isLunas?'Lunas':'Belum Lunas'}</span></td>
            <td class="py-4 px-6 text-center">${!isLunas ? `<button onclick="bukaModalEdit('Piutang', '${item[0]}')" class="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-500/30 hover:bg-indigo-700 transition-colors">Lunaskan</button>` : `<button onclick="cetakInvoicePelunasan('${item[0]}','${item[1]}',${item[2]})" class="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-sm border border-gray-200 hover:bg-gray-200"><i class="fa-solid fa-print"></i> Bukti</button>`}</td>
        </tr>`; 
    }); 
    tbody.innerHTML = htmlString;
}

window.cetakInvoicePelunasan = function(id, nama, total) { let tgl = new Date().toLocaleString('id-ID'); const printArea = document.getElementById('printArea'); printArea.innerHTML = `<div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:5px;margin-bottom:5px;"><h3 style="margin:0;font-size:16px;">BUKTI PELUNASAN</h3><p style="margin:0;font-size:10px;">Tgl: ${tgl}</p></div><table style="width:100%;font-size:11px;"><tr><td>Nama:</td><td style="text-align:right;">${nama}</td></tr><tr><td>Ref ID:</td><td style="text-align:right;">${id}</td></tr><tr><td><b>Total Lunas:</b></td><td style="text-align:right;"><b>${formatRp(total)}</b></td></tr></table><div style="text-align:center;margin-top:10px;font-size:10px;">Terima kasih atas pembayaran Anda.</div>`; document.body.classList.add('print-nota'); printArea.style.opacity = '1'; printArea.style.zIndex = '9999'; setTimeout(() => { window.print(); document.body.classList.remove('print-nota'); printArea.style.opacity = '0'; printArea.style.zIndex = '-999'; }, 500); }

function formatTanggalWIB(tanggalMentah) {
    if (!tanggalMentah || tanggalMentah === "-") return "-";
    const date = new Date(tanggalMentah);
    if (isNaN(date.getTime())) return tanggalMentah; 
    return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(date) + ' WIB';
}

window.tambahKategoriKasCustom = function() {
    const modalHtml = `
    <div id="modalCustomKategori" class="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 opacity-0 transition-opacity duration-300">
        <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 transform scale-95 transition-transform duration-300">
            <h3 class="font-black text-lg text-gray-800 mb-2">Kategori Pengeluaran Baru</h3>
            <p class="text-xs text-gray-500 font-medium mb-5">Contoh: Bensin, Konsumsi, Uang Keamanan, dll.</p>
            <input type="text" id="inputKategoriCustom" placeholder="Ketik nama kategori..." class="w-full px-5 py-4 border border-gray-200 rounded-xl font-bold bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none mb-5 text-gray-700">
            <div class="flex gap-3">
                <button onclick="tutupModalCustomKat()" class="flex-1 py-3.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors tracking-widest uppercase text-[10px]">Batal</button>
                <button onclick="simpanKategoriCustom()" class="flex-1 py-3.5 rounded-xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/30 transition-colors tracking-widest uppercase text-[10px]">Simpan</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const m = document.getElementById('modalCustomKategori');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); document.getElementById('inputKategoriCustom').focus(); }, 10);
    
    window.tutupModalCustomKat = () => {
        m.classList.add('opacity-0'); m.children[0].classList.add('scale-95');
        setTimeout(() => { m.remove(); }, 300);
    };
    
    window.simpanKategoriCustom = () => {
        let nama = document.getElementById('inputKategoriCustom').value.trim();
        if(nama !== "") {
            let sel = document.getElementById('kasKategori');
            if(!Array.from(sel.options).some(opt => opt.value.toLowerCase() === nama.toLowerCase())) {
                sel.add(new Option(nama, nama), sel.options.length - 1);
            }
            sel.value = nama;
            showToast("Kategori '" + nama + "' siap digunakan!", "success");
            tutupModalCustomKat();
        } else { showToast("Nama kategori tidak boleh kosong!", "error"); }
    };
}

function renderKeuangan(data, tbody) { 
    const listHistori = document.getElementById('listHistoriKas');
    const selKat = document.getElementById('kasKategori');
    if(listHistori) listHistori.innerHTML = '';
    let uniqueKet = new Set();
    let uniqueKategoriUtama = new Set();
    
    if (selKat) {
        let valSekarang = selKat.value;
        selKat.innerHTML = `<option value="Listrik/Air">Listrik / Air / Internet</option><option value="Gaji Karyawan">Gaji Karyawan</option><option value="Operasional">Operasional Harian Toko</option><option value="Beli Aksesoris / Stok Lain">Beli Aksesoris / Barang Non-Etalase</option><option value="Lainnya">Pengeluaran Lain-lain</option>`;
        selKat.value = valSekarang; 
    }

    if(data.length===0) return tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Data Kosong</td></tr>`; 
    
    let htmlString = '';
    data.forEach(item => { 
        htmlString += `<tr class="hover:bg-slate-50 border-b border-gray-50"><td class="py-4 px-6 text-xs font-bold text-gray-500 tracking-wider">${formatTanggalWIB(item[1])}</td><td class="py-4 px-6 font-black text-gray-800"><span class="bg-gray-100 px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-widest">${item[2]}</span></td><td class="py-4 px-6 font-semibold text-gray-600">${item[4]}</td><td class="py-4 px-6 text-right font-black text-rose-500 text-lg">-${formatRp(item[3])}</td></tr>`; 
        
        let kat = String(item[2]);
        if(!["Listrik/Air", "Gaji Karyawan", "Operasional", "Beli Aksesoris / Stok Lain", "Lainnya", "Penarikan Kasbon", "Bayar Hutang Supplier"].some(def => kat.includes(def))) {
            uniqueKategoriUtama.add(kat);
        }

        if(item[4] && item[4] !== "-" && !item[4].includes("Uang Keluar Laci")) {
            uniqueKet.add(item[4]);
        }
    }); 
    tbody.innerHTML = htmlString;
    
    if(selKat) {
        uniqueKategoriUtama.forEach(k => {
            if(!Array.from(selKat.options).some(opt => opt.value === k)) {
                selKat.add(new Option(k, k), selKat.options.length - 1);
            }
        });
    }

    if(listHistori) {
        let historiHtml = '';
        uniqueKet.forEach(ket => { historiHtml += `<option value="${ket}">`; });
        listHistori.innerHTML = historiHtml;
    }
}

function renderKasUsaha(data, tbody) { 
    if(data.length===0) return tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Data Kosong</td></tr>`; 
    let htmlString = '';
    data.forEach(item => {
        let strTipe = String(item[2]).toLowerCase();
        let isMasuk = strTipe.includes('masuk') || strTipe.includes('lunas');
        let badge = isMasuk ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100';
        
        let nominal = parseFloat(item[3]) || 0;
        let txtDebit = isMasuk ? formatRp(nominal) : "-";
        let txtKredit = !isMasuk ? formatRp(nominal) : "-";
        
        htmlString += `<tr class="hover:bg-slate-50 border-b border-gray-50">
            <td class="py-4 px-6 text-[10px] font-bold text-gray-500 whitespace-nowrap">${formatTanggalWIB(item[1])}</td>
            <td class="py-4 px-6 whitespace-nowrap"><span class="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${badge}">${item[2]}</span></td>
            <td class="py-4 px-6 text-right font-black text-emerald-600 whitespace-nowrap">${txtDebit}</td>
            <td class="py-4 px-6 text-right font-black text-rose-600 whitespace-nowrap">${txtKredit}</td>
            <td class="py-4 px-6 text-center text-xs font-bold text-indigo-500 whitespace-nowrap">${item[6] || item[5] || '-'}</td>
            <td class="py-4 px-6 font-bold text-gray-600 text-[11px] whitespace-normal min-w-[250px] leading-relaxed">${item[4]}</td>
        </tr>`;
    }); 
    tbody.innerHTML = htmlString;
}

function renderOpnameHistory(data, tbody) {
    if(data.length===0) return tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Belum ada riwayat audit</td></tr>`;
    let htmlString = '';
    data.forEach(item => { let selisih = parseInt(item[6]) || 0; let color = selisih < 0 ? 'text-rose-500' : (selisih > 0 ? 'text-amber-500' : 'text-emerald-500'); let badge = selisih === 0 ? 'bg-emerald-50' : (selisih < 0 ? 'bg-rose-50' : 'bg-amber-50'); htmlString += `<tr class="border-b border-gray-50 hover:bg-slate-50"><td class="py-3 px-4 font-bold text-gray-500">${item[1].split(' ')[0]}</td><td class="py-3 px-4 font-black text-gray-800 w-full truncate max-w-[150px] leading-tight" title="${item[3]}">${item[3]}<br><span class="text-[9px] text-gray-400">${item[2]}</span></td><td class="py-3 px-4 text-center font-black ${color} text-sm"><span class="${badge} px-2 py-0.5 rounded">${selisih}</span></td><td class="py-3 px-4 font-semibold text-gray-600 text-[10px] uppercase">${item[7]}</td></tr>`; });
    tbody.innerHTML = htmlString;
}

window.muatTabelPelanggan = () => muatTabelGenerik('Customer', 'tabelPelangganBody', renderPelanggan); window.muatTabelSupplier = () => muatTabelGenerik('Supplier', 'tabelSupplierBody', renderSupplier); window.muatTabelRiwayat = () => muatTabelGenerik('Transaksi (Header)', 'tabelRiwayatBody', renderRiwayat); window.muatTabelLayanan = () => muatTabelGenerik('Layanan', 'tabelLayananBody', renderLayanan); window.muatTabelRestock = () => muatTabelGenerik('Mutasi_Stok', 'tabelRestockBody', renderRestock); window.muatTabelRetur = () => muatTabelGenerik('Retur_Jual', 'tabelReturBody', renderRetur); window.muatTabelPiutang = () => muatTabelGenerik('Piutang', 'tabelPiutangBody', renderPiutang); window.muatTabelKeuangan = () => muatTabelGenerik('Pengeluaran', 'tabelKeuanganBody', renderKeuangan);
window.muatTabelOpnameHistory = () => muatTabelGenerik('Stok_Opname', 'tabelHistoryOpname', renderOpnameHistory);

async function muatTabelKasUsaha() {
    const tbody = document.getElementById('tabelKasUsahaBody'); if(!tbody) return; 
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 font-bold text-indigo-500 uppercase tracking-widest text-[10px]"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Merakit Buku Besar...</td></tr>`;
    
    const fetchTable = async (sheet) => {
        try { const r = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_master', token: localStorage.getItem('pos_token'), sheetName: sheet }) }); return await r.json(); } catch(e) { return {status: false, data: []}; }
    };

    function parseTglSort(dStr) {
        if(!dStr) return 0; let s = String(dStr);
        if (s.includes('/')) { let p = s.split(' '); let t = p[0].split('/'); return new Date(`${t[2]}-${t[1]}-${t[0]}T${p[1] || '00:00:00'}`).getTime() || 0; } 
        else { return new Date(s).getTime() || 0; }
    }

    try {
        const [resKas, resTrx, resPeng] = await Promise.all([ fetchTable('Buku_Kas'), fetchTable('Transaksi (Header)'), fetchTable('Pengeluaran') ]);
        let gabungan = [];

        if(resKas.status && resKas.data) {
            resKas.data.forEach(r => { gabungan.push({ tglSort: parseTglSort(r[1]), data: [r[0], r[1], r[2], r[3], r[4], "-", r[6] || r[5]] }); });
        }

        if(resTrx.status && resTrx.data) {
            resTrx.data.forEach(r => {
                if(r[12] === "Selesai") { 
                    let infoTrx = r[0].includes('TRX-SRV') || r[0].includes('TRX-TT') ? 'Service/TT' : 'Penjualan';
                    gabungan.push({ tglSort: parseTglSort(r[13] || r[2]), data: [r[0], r[13] || r[2], "Omzet Masuk", r[8], `[${infoTrx}] Nota: ${r[1]} | Pel: ${r[3]} | ${r[9]}`, "-", r[4]] });
                }
            });
        }

        if(resPeng.status && resPeng.data) {
            resPeng.data.forEach(r => { gabungan.push({ tglSort: parseTglSort(r[1]), data: [r[0], r[1], "Kas Keluar: " + r[2], r[3], r[4], "-", r[5]] }); });
        }

        let fBulan = document.getElementById('filterBulanKas') ? document.getElementById('filterBulanKas').value : 'Semua';
        let fTahun = document.getElementById('filterTahunKas') ? document.getElementById('filterTahunKas').value : 'Semua';
        
        let filtered = gabungan.filter(g => {
            let d = new Date(g.tglSort);
            if(isNaN(d.getTime())) return true;
            let m = String(d.getMonth() + 1).padStart(2, '0');
            let y = String(d.getFullYear());
            let matchBulan = (fBulan === 'Semua') || (m === fBulan);
            let matchTahun = (fTahun === 'Semua') || (y === fTahun);
            return matchBulan && matchTahun;
        });

        filtered.sort((a, b) => b.tglSort - a.tglSort);

        let finalData = filtered.slice(0, 1000).map(g => g.data);
        renderKasUsaha(finalData, tbody);

    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 font-bold text-rose-500 text-xs">Gagal memuat Buku Besar</td></tr>`;
    }
}

// =========================================================================================
// 8. MASTER BARANG (RENDER TABEL & EDIT KHUSUS OWNER)
// =========================================================================================
function bukaModalBarang() { document.getElementById('modalBarang').classList.remove('hidden'); setTimeout(() => { document.getElementById('modalBarang').classList.remove('opacity-0'); }, 10); }
function tutupModalBarang() { document.getElementById('modalBarang').classList.add('opacity-0'); setTimeout(() => { document.getElementById('modalBarang').classList.add('hidden'); document.getElementById('formTambahBarang').reset(); }, 300); }

async function muatTabelBarang() { 
    const tbody = document.getElementById('tabelBarangBody'); 
    if(!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-indigo-500 opacity-80"><i class="fa-solid fa-circle-notch fa-spin text-4xl mb-3 block"></i><span class="font-black uppercase tracking-widest text-xs">Menarik Data Gudang...</span></td></tr>`; 
    try { 
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_barang', token: localStorage.getItem('pos_token') }) }); 
        const result = await res.json(); 
        if (result.status === true) { 
            katalogBarang = result.data; 
            updateDropdownSKU(katalogBarang);

            if (katalogBarang.length === 0) return tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 font-bold text-gray-400 uppercase tracking-widest text-xs">Belum ada barang di Database</td></tr>`; 
            
            let fBulan = document.getElementById('filterBulanBarang') ? document.getElementById('filterBulanBarang').value : 'Semua';
            let fTahun = document.getElementById('filterTahunBarang') ? document.getElementById('filterTahunBarang').value : 'Semua';
            let fStatus = document.getElementById('statusFilterBarang') ? document.getElementById('statusFilterBarang').value : 'Tersedia';

            let filteredBarang = katalogBarang.filter(item => {
                let matchStatus = false;
                if(fStatus === 'Tersedia') matchStatus = item.stok > 0 && item.status !== 'Dihapus';
                else if(fStatus === 'Habis') matchStatus = item.stok <= 0 && item.status !== 'Dihapus';
                else if(fStatus === 'Arsip') matchStatus = item.status === 'Dihapus';

                if(!matchStatus) return false;

                let tglInput = item.tglInput || "";
                if(!tglInput || tglInput === "-") return true; 
                
                let strDate = String(tglInput).split(' ')[0]; let arrTgl;
                if (strDate.includes('-')) { let parts = strDate.split('-'); if(parts[0].length === 4) arrTgl = [parts[0], parts[1], parts[2]]; else arrTgl = [parts[2], parts[1], parts[0]]; } 
                else if (strDate.includes('/')) { let parts = strDate.split('/'); arrTgl = [parts[2].substring(0,4), (parts[1].length===1?'0'+parts[1]:parts[1]), (parts[0].length===1?'0'+parts[0]:parts[0])]; }
                if(!arrTgl) return true;
                
                let m = arrTgl[1]; let y = arrTgl[0];
                let matchBulan = (fBulan === 'Semua') || (m === fBulan);
                let matchTahun = (fTahun === 'Semua') || (y === fTahun);
                return matchBulan && matchTahun;
            });

            if (filteredBarang.length === 0) return tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 font-bold text-gray-400 uppercase tracking-widest text-xs">Tidak ada barang sesuai filter</td></tr>`; 
            
            let htmlString = '';
            filteredBarang.forEach(item => { 
                let isHabis = item.stok <= 0; let stBadge = item.status === 'Baru' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-amber-50 text-amber-600 border-amber-100'; 
                let detailSpesifikasi = ""; if(item.kapasitas !== '-' || item.warna !== '-') detailSpesifikasi = `<span class="text-[9px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">${item.kapasitas}</span> <span class="text-[9px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">${item.warna}</span>`;
                let minusBadge = (item.minus && item.minus !== '-' && item.minus !== '') ? `<span class="text-[9px] font-bold text-rose-500 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded mt-1.5 inline-block w-fit"><i class="fa-solid fa-triangle-exclamation"></i> Minus: ${item.minus}</span>` : '';
                htmlString += `<tr class="hover:bg-slate-50 border-b border-gray-100"><td class="py-4 px-6 font-black text-xs uppercase tracking-widest text-indigo-600 bg-indigo-50/30">${item.sku}<br><span class="text-[9px] text-gray-400 font-bold mt-1 inline-block font-mono tracking-wider"><i class="fa-solid fa-barcode"></i> ${item.imei||'-'}</span></td><td class="py-4 px-6 font-black text-gray-800">${item.namaBarang}<br><div class="flex flex-wrap gap-1 mt-1.5">${detailSpesifikasi} <span class="text-[9px] font-black px-2 py-0.5 rounded border ${stBadge}">${item.status||'Baru'}</span></div>${minusBadge}</td><td class="py-4 px-6 text-right text-indigo-600 font-black text-lg">${formatRp(item.hargaJual)}</td><td class="py-4 px-6 text-center"><span class="px-4 py-1.5 rounded-lg text-xs font-black tracking-widest ${isHabis?'bg-rose-50 text-rose-600 border border-rose-100':'bg-emerald-50 text-emerald-600 border border-emerald-100'}">${isHabis?'HABIS':item.stok}</span></td><td class="py-4 px-6 text-center flex justify-center gap-2"><button onclick="cetakLabelBarcode('${item.sku}', '${item.namaBarang}', ${item.hargaJual}, '${item.kapasitas} ${item.warna}', '${item.imei}')" class="bg-white border border-gray-200 text-gray-700 w-9 h-9 rounded-xl text-[12px] font-black hover:bg-gray-50 transition-transform active:scale-95 shadow-sm flex items-center justify-center"><i class="fa-solid fa-barcode"></i></button><button onclick="bukaModalEdit('Barang', '${item.idBarang}')" class="text-indigo-500 bg-indigo-50 hover:bg-indigo-500 hover:text-white w-9 h-9 rounded-xl flex items-center justify-center transition-colors shadow-sm mr-2"><i class="fa-solid fa-pen-to-square"></i></button><button onclick="hapusBarangDariKatalog('${item.idBarang}')" class="text-rose-500 bg-rose-50 hover:bg-rose-500 hover:text-white w-9 h-9 rounded-xl flex items-center justify-center transition-colors shadow-sm"><i class="fa-solid fa-trash-can"></i></button></td></tr>`; 
            }); 
            tbody.innerHTML = htmlString;
        } 
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12"><i class="fa-solid fa-satellite-dish text-rose-400 text-4xl mb-4 block"></i><p class="font-black uppercase tracking-widest text-xs text-rose-500 mb-4">Koneksi Terputus / Server Sibuk</p><button onclick="muatTabelBarang()" class="bg-rose-50 text-rose-600 border border-rose-200 px-6 py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-rose-500 hover:text-white transition-colors shadow-sm"><i class="fa-solid fa-rotate mr-1"></i> Coba Lagi</button></td></tr>`;
    } 
}

// =========================================================================================
// 9. FORM BINDING & EDIT BARANG
// =========================================================================================
window.toggleBiayaService = function(val) { const panel = document.getElementById('panelBiayaSelesai'); if(val === 'Selesai') panel.classList.remove('hidden'); else panel.classList.add('hidden'); }

function bukaModalEdit(konteks, idRow) {
    const modal = document.getElementById('modalEdit'); const container = document.getElementById('editFormContainer'); const title = document.getElementById('editTitle');
    if(konteks === 'Piutang') { title.innerText = "Eksekusi Pelunasan"; container.innerHTML = `<p class="text-sm font-bold text-gray-600 mb-5 leading-relaxed">Tandai tagihan/hutang ini sebagai Lunas?<br><br>Sistem akan otomatis <b>Menambah Kas</b> (jika ini Piutang Pelanggan) atau <b>Memotong Kas</b> (jika ini Hutang Toko ke Supplier) sesuai tipe yang Anda pilih di awal.</p><button onclick="lunasiPiutang('${idRow}')" class="w-full bg-emerald-500 text-white font-black text-lg py-4.5 rounded-2xl shadow-lg shadow-emerald-500/30 hover:bg-emerald-600 transition-colors">EKSEKUSI PELUNASAN</button>`; } 
    else if(konteks === 'Layanan') { title.innerText = "Penyelesaian Service"; container.innerHTML = `<select id="editStatusVal" onchange="toggleBiayaService(this.value)" class="w-full px-5 py-4 border border-gray-200 rounded-2xl mb-4 font-bold bg-white focus:ring-4 focus:ring-indigo-500/20 outline-none shadow-sm"><option value="Diterima">Masih Service / Belum Selesai</option><option value="Selesai">Selesai (Siap Diambil & Bayar)</option><option value="Dibatalkan">Dibatalkan</option></select><div id="panelBiayaSelesai" class="hidden space-y-4 mb-5 p-5 bg-indigo-50 rounded-2xl border border-indigo-100 shadow-inner"><p class="text-[10px] font-black text-indigo-600 uppercase tracking-widest"><i class="fa-solid fa-cash-register mr-1"></i> Pembayaran Kasir</p><input type="text" inputmode="numeric" id="editBiayaAkhir" placeholder="Biaya Akhir / Deal (Rp)" class="input-rupiah w-full px-5 py-4 border border-white rounded-xl font-black text-indigo-600 focus:ring-2 focus:ring-indigo-500 outline-none text-lg shadow-sm"><select id="editMetodeSelesai" class="w-full px-5 py-3 border border-white rounded-xl font-bold focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm text-sm"><option value="Cash">Tunai / Cash</option><option value="Transfer Bank">Transfer Bank</option><option value="QRIS">QRIS</option></select><p class="text-[9px] text-indigo-400 font-bold leading-tight">Uang akan otomatis tercatat ke Laporan Penjualan/Omzet Hari Ini.</p></div><button onclick="kirimUpdateLayanan('${idRow}')" class="w-full bg-indigo-600 text-white font-black text-lg py-4.5 rounded-2xl shadow-lg shadow-indigo-500/30 hover:bg-indigo-700 transition-colors">Simpan Status</button>`; }
    else if(konteks === 'Barang') { 
        const role = localStorage.getItem('pos_role') || ''; const uname = localStorage.getItem('pos_username') || '';
        const isOwner = role.toLowerCase().includes('admin') || role.toLowerCase().includes('laporan') || role.toLowerCase().includes('owner') || uname.toLowerCase() === 'owner' || role === '';
        if(isOwner) {
            const brg = katalogBarang.find(b => b.idBarang === idRow); if(!brg) return showToast("Gagal memuat barang", "error");
            title.innerText = "Edit Spesifikasi & Harga"; 
            container.innerHTML = `<div class="space-y-4"><div><label class="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">Nama Produk</label><input type="text" id="editBrgNama" class="w-full px-4 py-3 border border-gray-200 rounded-xl font-bold bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none" value="${brg.namaBarang}"></div><div class="grid grid-cols-2 gap-3"><div><label class="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">Kapasitas</label><input type="text" id="editBrgKap" class="w-full px-4 py-3 border border-gray-200 rounded-xl font-bold bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none" value="${brg.kapasitas}"></div><div><label class="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">Warna</label><input type="text" id="editBrgWarna" class="w-full px-4 py-3 border border-gray-200 rounded-xl font-bold bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none" value="${brg.warna}"></div><div class="col-span-2"><label class="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">IMEI / SN</label><input type="text" id="editBrgIMEI" class="w-full px-4 py-3 border border-gray-200 rounded-xl font-bold bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono" value="${brg.imei}"></div><div class="col-span-2"><label class="text-[10px] font-black text-amber-500 uppercase tracking-widest ml-1 mb-1 block">Info Minus</label><input type="text" id="editBrgMinus" class="w-full px-4 py-3 border border-amber-200 rounded-xl font-bold bg-amber-50 shadow-sm focus:ring-2 focus:ring-amber-500 outline-none text-amber-900" value="${brg.minus}"></div></div><div class="grid grid-cols-2 gap-3"><div><label class="text-[10px] font-black text-rose-400 uppercase tracking-widest ml-1 mb-1 block">Harga Modal</label><input type="text" inputmode="numeric" id="editBrgModal" class="input-rupiah w-full px-4 py-3 border border-rose-200 rounded-xl font-black text-rose-600 bg-rose-50/50 shadow-sm focus:ring-2 focus:ring-rose-500 outline-none" value="${new Intl.NumberFormat('id-ID').format(brg.hargaModal)}"></div><div><label class="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1 mb-1 block">Harga Jual</label><input type="text" inputmode="numeric" id="editBrgJual" class="input-rupiah w-full px-4 py-3 border border-emerald-200 rounded-xl font-black text-emerald-600 bg-emerald-50/50 shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none" value="${new Intl.NumberFormat('id-ID').format(brg.hargaJual)}"></div></div><div><label class="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">Stok Fisik</label><input type="number" id="editBrgStok" class="w-full px-4 py-3 border border-gray-200 rounded-xl font-black text-gray-800 text-center text-xl bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none" value="${brg.stok}"></div><button onclick="kirimUpdateBarang('${idRow}')" class="w-full bg-slate-900 text-white font-black text-lg py-4 rounded-xl shadow-xl hover:bg-black transition-all transform active:scale-95 mt-2">Simpan Perubahan Data</button></div>`;
        } else { title.innerText = "Akses Terbatas"; container.innerHTML = `<p class="text-sm text-indigo-700 bg-indigo-50 p-5 rounded-2xl mb-6 font-bold border border-indigo-100 shadow-inner leading-relaxed"><i class="fa-solid fa-shield-halved mr-2 text-lg text-indigo-400"></i>Sesuai SOP, perubahan Harga dan Spesifikasi Barang hanya dapat diakses oleh Administrator/Owner.</p><button onclick="tutupModalEdit()" class="w-full bg-slate-900 text-white font-black text-lg py-4.5 rounded-2xl shadow-xl shadow-slate-900/20 hover:bg-black transition-colors transform active:scale-95">Saya Mengerti</button>`; }
    }
    modal.classList.remove('hidden'); setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function tutupModalEdit() { const modal = document.getElementById('modalEdit'); modal.classList.add('opacity-0'); setTimeout(() => modal.classList.add('hidden'), 300); }

window.lunasiPiutang = async function(idRow) {
    tutupModalEdit(); showToast("Memproses Pelunasan...", "success");
    try { 
        await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'lunaskan_piutang', token: localStorage.getItem('pos_token'), id: idRow, user: localStorage.getItem('pos_username') || 'Admin' }) }); 
        showToast("Piutang Lunas & Kas Masuk!", "success"); 
        window.muatTabelPiutang(); window.muatTabelKasUsaha(); kalkulasiKeuanganDashboard(); 
    } catch(e) { showToast("Gagal Memproses", "error"); }
}

async function kirimUpdate(sheetName, idRow, newVal) { tutupModalEdit(); showToast("Menyinkronkan Server...", "success"); try { await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'update_status', token: localStorage.getItem('pos_token'), sheetName: sheetName, id: idRow, val: newVal }) }); showToast("Database Berhasil Diupdate!"); if(sheetName==='Piutang') window.muatTabelPiutang(); if(sheetName==='Layanan') window.muatTabelLayanan(); if(sheetName==='User Login') window.muatTabelUser(); } catch(e) {} }

// LOGIKA MANAJEMEN KARYAWAN (TAMPIL, HAPUS, EDIT)
window.muatTabelUser = () => muatTabelGenerik('User Login', 'tabelUserBody', renderUser);
function renderUser(data, tbody) {
    if(data.length===0) return tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-xs">Data Kosong</td></tr>`; 
    let htmlString = '';
    data.forEach(item => {
        let isOwner = String(item[8]).toLowerCase().includes('owner') || String(item[2]).toLowerCase() === 'owner';
        let stBadge = item[7] === 'Aktif' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100';
        let actionHtml = isOwner ? `<span class="text-[10px] font-bold text-gray-400"><i class="fa-solid fa-lock"></i> Protected</span>` : `<button onclick="bukaModalEditUser('${item[0]}', '${item[2]}', '${item[8]}')" class="text-indigo-500 bg-indigo-50 hover:bg-indigo-500 hover:text-white w-8 h-8 rounded-lg mr-2 transition-colors"><i class="fa-solid fa-pen"></i></button><button onclick="hapusUser('${item[0]}')" class="text-rose-500 bg-rose-50 hover:bg-rose-500 hover:text-white w-8 h-8 rounded-lg transition-colors"><i class="fa-solid fa-trash"></i></button>`;
        htmlString += `<tr class="hover:bg-slate-50 border-b border-gray-50"><td class="py-4 px-6 font-bold text-gray-500 text-xs">${item[1]}</td><td class="py-4 px-6 font-black text-gray-800">${item[2]}</td><td class="py-4 px-6 text-[10px] font-bold text-indigo-600 w-64 whitespace-normal break-words">${item[8]}</td><td class="py-4 px-6 text-center"><span class="px-3 py-1.5 rounded-lg text-[10px] font-black tracking-widest uppercase border ${stBadge}">${item[7]}</span></td><td class="py-4 px-6 text-center">${actionHtml}</td></tr>`;
    });
    tbody.innerHTML = htmlString;
}

window.hapusUser = function(id) {
    customConfirm("PERINGATAN: Karyawan ini tidak akan bisa login lagi ke sistem. Lanjutkan?", () => {
        kirimUpdate('User Login', id, 'Dihapus');
    });
}

window.bukaModalEditUser = function(id, username, rolesStr) {
    const modal = document.getElementById('modalEdit'); const container = document.getElementById('editFormContainer'); const title = document.getElementById('editTitle');
    title.innerText = "Edit Akses: " + username;
    let roles = rolesStr.split(',').map(r => r.trim());
    container.innerHTML = `
        <div class="space-y-4">
            <p class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Pilih Ulang Hak Akses Menu</p>
            <div class="grid grid-cols-2 gap-3 bg-white p-4 rounded-xl border border-gray-200 h-48 overflow-y-auto custom-scrollbar" id="editCheckboxPermissions">
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="POS" class="w-4 h-4 text-indigo-600" ${roles.includes('POS')?'checked':''}> Kasir (POS)</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Riwayat" class="w-4 h-4 text-indigo-600" ${roles.includes('Riwayat')?'checked':''}> Riwayat</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Barang" class="w-4 h-4 text-indigo-600" ${roles.includes('Barang')?'checked':''}> Katalog</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Restock" class="w-4 h-4 text-indigo-600" ${roles.includes('Restock')?'checked':''}> Mutasi Masuk</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Opname" class="w-4 h-4 text-indigo-600" ${roles.includes('Opname')?'checked':''}> Opname</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Layanan" class="w-4 h-4 text-indigo-600" ${roles.includes('Layanan')?'checked':''}> Service/TT</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Retur" class="w-4 h-4 text-indigo-600" ${roles.includes('Retur')?'checked':''}> Retur Supplier</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="CRM" class="w-4 h-4 text-indigo-600" ${roles.includes('CRM')?'checked':''}> Pelanggan</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Supplier" class="w-4 h-4 text-indigo-600" ${roles.includes('Supplier')?'checked':''}> Pemasok</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Kas" class="w-4 h-4 text-indigo-600" ${roles.includes('Kas')?'checked':''}> Buku Kas</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Pengeluaran" class="w-4 h-4 text-indigo-600" ${roles.includes('Pengeluaran')?'checked':''}> Pengeluaran</label>
                <label class="flex items-center gap-2 text-xs font-bold text-gray-700"><input type="checkbox" value="Piutang" class="w-4 h-4 text-indigo-600" ${roles.includes('Piutang')?'checked':''}> Piutang</label>
                <label class="flex items-center gap-2 text-xs font-bold text-rose-600"><input type="checkbox" value="Laporan" class="w-4 h-4 text-rose-600" ${roles.includes('Laporan')?'checked':''}> Laporan Laba</label>
            </div>
            <input type="password" id="editUsrPass" placeholder="Password Baru (Kosongkan jika tidak diubah)" class="w-full px-5 py-3 border border-gray-200 rounded-xl bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-sm mt-3">
            <button onclick="kirimUpdateUser('${id}')" class="w-full bg-slate-900 text-white font-black text-lg py-4 rounded-xl shadow-xl hover:bg-black transition-colors mt-2">Simpan Perubahan</button>
        </div>`;
    modal.classList.remove('hidden'); setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

window.kirimUpdateUser = async function(idRow) {
    const btn = event.target; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; btn.disabled = true;
    let roles = []; document.querySelectorAll('#editCheckboxPermissions input:checked').forEach(cb => roles.push(cb.value));
    let finalRole = roles.length > 0 ? roles.join(', ') : "POS"; 
    let passRaw = document.getElementById('editUsrPass').value.trim();
    let hashed = passRaw ? await hashSHA256(passRaw) : "";

    try { 
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'update_user', token: localStorage.getItem('pos_token'), id: idRow, role: finalRole, password: hashed }) }); 
        const result = await res.json();
        
        if (result.status) {
            showToast("Hak Akses Karyawan Diperbarui!", "success"); 
            tutupModalEdit(); 
            window.muatTabelUser(); 
        } else {
            showToast(result.message, "error"); 
            btn.innerHTML = 'Simpan Perubahan'; 
            btn.disabled = false;
        }
    } catch(e) { 
        showToast("Gagal update karyawan", "error"); 
        btn.innerHTML = 'Simpan Perubahan'; 
        btn.disabled = false; 
    }
}

window.kirimUpdateLayanan = async function(idRow) {
    const status = document.getElementById('editStatusVal').value;
    if(status === 'Selesai') {
        const biaya = cleanRupiah(document.getElementById('editBiayaAkhir').value); const metode = document.getElementById('editMetodeSelesai').value;
        if(biaya <= 0) return showToast("Biaya akhir (Deal) harus diisi untuk laporan!", "error");
        tutupModalEdit(); showToast("Merekam Uang Masuk...", "success");
        try { await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'selesaikan_service', token: localStorage.getItem('pos_token'), id: idRow, biayaAkhir: biaya, metode: metode, user: localStorage.getItem('pos_username')||'Admin' }) }); showToast("Service Selesai & Uang Tercatat!", "success"); window.muatTabelLayanan(); muatLaporan(); } catch(e) { showToast("Gagal memproses kasir", "error"); }
    } else { kirimUpdate('Layanan', idRow, status); }
}

window.kirimUpdateBarang = async function(idRow) {
    const btn = event.target; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; btn.disabled = true;
    const payload = { action: 'update_barang', token: localStorage.getItem('pos_token'), id: idRow, nama: document.getElementById('editBrgNama').value, kapasitas: document.getElementById('editBrgKap').value, warna: document.getElementById('editBrgWarna').value, imei: document.getElementById('editBrgIMEI').value, minus: document.getElementById('editBrgMinus').value, modal: cleanRupiah(document.getElementById('editBrgModal').value), jual: cleanRupiah(document.getElementById('editBrgJual').value), stok: document.getElementById('editBrgStok').value };
    try { await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) }); showToast("Barang diupdate!", "success"); tutupModalEdit(); muatTabelBarang(); muatKatalogBarang(); } catch(e) { showToast("Gagal update barang", "error"); btn.innerHTML = 'Simpan Perubahan Data'; btn.disabled = false; }
}

// BINDING SERVICE KHUSUS AGAR BISA PRINT LABEL
document.getElementById('formService')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = document.getElementById('btnSubmitService'); let oriText = btn.innerHTML; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`; btn.disabled = true; 
    let idSrv = "SRV-" + new Date().getTime(); let nama = document.getElementById('srvNama').value; let wa = document.getElementById('srvWA').value; let tipe = document.getElementById('srvTipe').value; let imei = document.getElementById('srvIMEI').value; let kendala = document.getElementById('srvKendala').value; let biaya = cleanRupiah(document.getElementById('srvBiayaEstimasi').value) || 0;
    let rowData = new Array(30).fill("-"); rowData[0] = idSrv; rowData[1] = nama; rowData[2] = wa; rowData[3] = tipe; rowData[4] = kendala; rowData[5] = biaya; rowData[6] = "Diterima"; rowData[7] = new Date().toLocaleString('id-ID'); 
    try { await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'add_master', token: localStorage.getItem('pos_token'), sheetName: 'Layanan', rowData: rowData }) }); showToast("Antrian Service Dibuat!", "success"); document.getElementById('formService').reset(); window.muatTabelLayanan(); cetakLabelService(idSrv.substring(0, 10), nama, tipe, imei, kendala); } catch (e) { showToast("Gagal Terhubung", "error"); } finally { btn.innerHTML = oriText; btn.disabled = false; }
});

// KALKULATOR TUKAR TAMBAH
window.hitungEstimasiTT = function() {
    let skuBaru = document.getElementById('ttSkuBaru').value; let taksiran = cleanRupiah(document.getElementById('ttTaksiran').value) || 0; let sisaBayar = 0;
    if(skuBaru) { let brg = katalogBarang.find(b => b.sku === skuBaru); if(brg) { sisaBayar = brg.hargaJual - taksiran; if(sisaBayar < 0) sisaBayar = 0; } }
    document.getElementById('ttSisaBayar').textContent = formatRp(sisaBayar);
}

document.getElementById('formTT')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = document.getElementById('btnSubmitTT'); let ori = btn.innerHTML; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengeksekusi Aset...'; btn.disabled = true;
    const payload = { pelanggan: document.getElementById('ttNama').value, wa: document.getElementById('ttWA').value, hpLama: document.getElementById('ttHpLama').value, kapasitasLama: document.getElementById('ttKapasitasLama').value, warnaLama: document.getElementById('ttWarnaLama').value, imeiLama: document.getElementById('ttImeiLama').value, minusLama: document.getElementById('ttMinus').value, taksiranLama: cleanRupiah(document.getElementById('ttTaksiran').value), skuBaru: document.getElementById('ttSkuBaru').value, metodeSelisih: document.getElementById('ttMetode').value, user: localStorage.getItem('pos_username') || 'Admin' };
    const brg = katalogBarang.find(b => b.sku === payload.skuBaru); 
    if(!brg) { showToast("Barang baru tidak valid", "error"); btn.innerHTML = ori; btn.disabled = false; return; } payload.hargaBaru = brg.hargaJual;
    try { const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'proses_tt', token: localStorage.getItem('pos_token'), payload: payload }) }); const result = await res.json(); if(result.status) { showToast("Proses TT Selesai! HP Bekas masuk Gudang.", "success"); document.getElementById('formTT').reset(); document.getElementById('ttSisaBayar').textContent = 'Rp 0'; muatTabelLayanan(); muatKatalogBarang(); muatLaporan(); window.muatTabelKeuangan(); kalkulasiKeuanganDashboard(); } else showToast(result.message, "error"); } catch(e) { showToast("Gagal memproses TT", "error"); } finally { btn.innerHTML = ori; btn.disabled = false; }
});

// BINDING RESTOCK (MEMOTONG KAS V30)
document.getElementById('formRestock')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = document.getElementById('btnSubmitRestock'); let ori = btn.innerHTML; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses...`; btn.disabled = true;
    const payload = { sku: document.getElementById('rstSKU').value.toUpperCase(), qty: parseInt(document.getElementById('rstQty').value), hargaTotal: cleanRupiah(document.getElementById('rstHarga').value), supplier: document.getElementById('rstSupplier').value, user: localStorage.getItem('pos_username') || 'Admin' };
    try { const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'proses_restock', token: localStorage.getItem('pos_token'), payload: payload }) }); const result = await res.json(); if(result.status) { showToast(result.message, "success"); document.getElementById('formRestock').reset(); window.muatTabelRestock(); muatKatalogBarang(); window.muatTabelKeuangan(); kalkulasiKeuanganDashboard(); muatLaporan(); } else showToast(result.message, "error"); } catch (e) { showToast("Gagal Terhubung", "error"); } finally { btn.innerHTML = ori; btn.disabled = false; }
});

function bindFormSubmit(formId, btnId, sheetName, prefix, getArrayFunc, successMsg, refreshFunc) {
    document.getElementById(formId)?.addEventListener('submit', async (e) => {
        e.preventDefault(); const btn = document.getElementById(btnId); let oriText = btn.innerHTML; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`; btn.disabled = true; 
        let rowData = new Array(15).fill("-"); rowData[0] = prefix + new Date().getTime(); getArrayFunc(rowData);
        try { await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'add_master', token: localStorage.getItem('pos_token'), sheetName: sheetName, rowData: rowData }) }); showToast(successMsg, "success"); document.getElementById(formId).reset(); refreshFunc(); } catch (e) { showToast("Gagal Terhubung", "error"); } finally { btn.innerHTML = oriText; btn.disabled = false; }
    });
}

document.getElementById('formPengaturanToko')?.addEventListener('submit', async (e) => { e.preventDefault(); const btn = document.querySelector('#formPengaturanToko button'); const oriText = btn.innerHTML; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyinkronkan...`; btn.disabled = true; const namaToko = document.getElementById('setNamaToko').value; const pesanStruk = document.getElementById('setPesanStruk').value; try { const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'save_settings', token: localStorage.getItem('pos_token'), settings: { NAMA_TOKO: namaToko, PESAN_STRUK: pesanStruk } }) }); const result = await res.json(); if(result.status) { showToast("Profil Toko tersimpan di Server!", "success"); localStorage.setItem('pos_nama_toko', namaToko); localStorage.setItem('pos_pesan_struk', pesanStruk); } else showToast(result.message, "error"); } catch(e) { showToast("Gagal koneksi server", "error"); } finally { btn.innerHTML = oriText; btn.disabled = false; } });

// PENGIRIMAN DATA FORM BERSIH LAINNYA
bindFormSubmit('formTambahBarang', 'btnSimpanBarang', 'Barang', 'BRG-', (row) => { row[1] = document.getElementById('inputSKU').value.trim().toUpperCase(); row[2] = document.getElementById('inputKategori').value; row[3] = document.getElementById('inputNama').value.trim(); row[4] = document.getElementById('inputKapasitas').value.trim() || "-"; row[5] = document.getElementById('inputWarna').value.trim() || "-"; row[6] = document.getElementById('inputIMEI').value.trim() || "-"; row[7] = document.getElementById('inputMinus').value.trim() || "-"; row[8] = cleanRupiah(document.getElementById('inputModal').value); row[9] = cleanRupiah(document.getElementById('inputJual').value); row[10] = document.getElementById('inputStok').value; row[11] = document.getElementById('inputStatus').value; row[12] = new Date().toLocaleString('id-ID'); row[13] = localStorage.getItem('pos_user_id'); }, "Barang Masuk Database", () => { tutupModalBarang(); muatTabelBarang(); muatKatalogBarang(); });
bindFormSubmit('formPengeluaran', 'btnSubmitKas', 'Keuangan', 'TRX-', (row) => { 
    let d = new Date(); 
    row[1] = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; 
    row[2] = document.getElementById('kasKategori').value; 
    row[3] = cleanRupiah(document.getElementById('kasNominal').value); 
    row[4] = document.getElementById('kasKet').value; 
    row[5] = localStorage.getItem('pos_username') || 'Admin'; 
}, "Pengeluaran Kas Disahkan!", () => { window.muatTabelKeuangan(); kalkulasiKeuanganDashboard(); muatLaporan(); });

document.getElementById('formRetur')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSubmitRetur'); let ori = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses Retur...`; btn.disabled = true;

    const payload = {
        supplier: document.getElementById('returSupplier').value,
        sku: document.getElementById('returSKU').value,
        alasan: document.getElementById('returAlasan').value,
        aksi: document.getElementById('returAksi').value,
        user: localStorage.getItem('pos_username') || 'Admin'
    };

    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'proses_retur', token: localStorage.getItem('pos_token'), payload: payload }) });
        const result = await res.json();
        if (result.status) {
            showToast(result.message, "success");
            document.getElementById('formRetur').reset();
            window.muatTabelRetur(); muatKatalogBarang(); window.muatTabelKasUsaha(); kalkulasiKeuanganDashboard(); muatLaporan();
        } else { showToast(result.message, "error"); }
    } catch (e) { showToast("Gagal memproses retur", "error"); } finally { btn.innerHTML = ori; btn.disabled = false; }
});

document.getElementById('formPiutang')?.addEventListener('submit', async (e) => {
    e.preventDefault(); 
    const btn = document.getElementById('btnSubmitPiutang'); let oriText = btn.innerHTML; 
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses...`; btn.disabled = true; 
    
    let nama = document.getElementById('piutangNama').value; 
    let nominal = cleanRupiah(document.getElementById('piutangTotal').value); 
    let rawDate = document.getElementById('piutangTempo').value;
    let tglTempo = rawDate ? rawDate.split('-').reverse().join('/') : "-"; 
    let ket = document.getElementById('piutangKet').value; 
    let tipe = document.getElementById('piutangTipe').value;
    let waktu = new Date().toLocaleString('id-ID'); 
    let user = localStorage.getItem('pos_username') || 'Admin'; 

    let idPiutang = 'PIU-' + new Date().getTime();
    let rowPiutang = new Array(15).fill("-");
    rowPiutang[0] = idPiutang; rowPiutang[1] = nama; rowPiutang[2] = nominal; rowPiutang[3] = tglTempo; 
    rowPiutang[4] = ket + ` [${tipe}]`; rowPiutang[5] = waktu; rowPiutang[6] = user; rowPiutang[7] = 'Belum Lunas';
    
    try { 
        // 1. Simpan Histori ke Buku Piutang
        await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'add_master', token: localStorage.getItem('pos_token'), sheetName: 'Piutang', rowData: rowPiutang }) }); 
        
        // 2. Jika tipe Kasbon Uang, OTOMATIS POTONG KAS!
        if (tipe === "Kasbon Uang") {
            let d = new Date(); 
            let tglKas = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; 
            let rowKas = new Array(15).fill("-");
            rowKas[0] = "KAS-" + new Date().getTime(); rowKas[1] = tglKas; rowKas[2] = "Penarikan Kasbon"; 
            rowKas[3] = nominal; rowKas[4] = `Uang Keluar Laci (Kasbon): ${nama}`; rowKas[6] = user;
            await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'add_master', token: localStorage.getItem('pos_token'), sheetName: 'Buku_Kas', rowData: rowKas }) }); 
        }

        showToast("Tagihan/Kasbon Dicatat!", "success"); 
        document.getElementById('formPiutang').reset(); 
        window.muatTabelPiutang();
        
        // Perbarui Dasbor dan Tabel
        if (tipe === "Kasbon Uang") { 
            window.muatTabelKasUsaha(); 
            kalkulasiKeuanganDashboard(); 
            muatLaporan();
        }
    } catch (err) { 
        showToast("Gagal Terhubung ke Server", "error"); 
    } finally { 
        btn.innerHTML = oriText; btn.disabled = false; 
    }
});

bindFormSubmit('formKasUsaha', 'btnSubmitKasUsaha', 'Buku_Kas', 'KAS-', (row) => { 
    let d = new Date(); 
    row[1] = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; 
    row[2] = document.getElementById('kasUsahaTipe').value; 
    row[3] = cleanRupiah(document.getElementById('kasUsahaNominal').value); 
    row[4] = document.getElementById('kasUsahaKet').value; 
    row[5] = "-"; 
    row[6] = localStorage.getItem('pos_username') || 'Admin'; 
}, "Mutasi Kas Disimpan!", () => { window.muatTabelKasUsaha(); kalkulasiKeuanganDashboard(); });

// REVISI: Input pelanggan terpisah alamat
bindFormSubmit('formPelanggan', 'btnSubmitPelanggan', 'Pelanggan', 'CUST-', (row) => { 
    row[1] = document.getElementById('pelNama').value; 
    row[2] = document.getElementById('pelWA').value; 
    row[4] = document.getElementById('pelAlamat').value || "-"; 
}, "Pelanggan Disimpan!", window.muatTabelPelanggan);

// REVISI: Input Supplier memisahkan Nama PT dan Nama PIC
bindFormSubmit('formSupplier', 'btnSubmitSupplier', 'Supplier', 'SUP-', (row) => { 
    row[1] = document.getElementById('supNama').value; 
    row[2] = document.getElementById('supPIC').value; 
    row[3] = document.getElementById('supWA').value; 
    row[4] = "-"; row[5] = "-"; row[6] = "-"; row[7] = "-"; 
    row[8] = document.getElementById('supKategori').value || "-"; 
    row[9] = "Aktif"; 
}, "Data Supplier Tersimpan!", window.muatTabelSupplier);

// BINDING SECURITY V30: Menambah Akses Karyawan dengan Hashed Password
document.getElementById('formUserBaru')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSubmitUser'); let oriText = btn.innerHTML; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`; btn.disabled = true;
    
    let usrNama = document.getElementById('usrNama').value.trim();
    let usrPassRaw = document.getElementById('usrPass').value.trim();
    let roles = [];
    document.querySelectorAll('#checkboxPermissions input:checked').forEach(cb => roles.push(cb.value));
    let finalRole = roles.length > 0 ? roles.join(', ') : "POS"; 
    
    let hashedPassword = await hashSHA256(usrPassRaw);
    let rowData = new Array(15).fill("-");
    rowData[0] = "ID-" + new Date().getTime(); 
    rowData[1] = "KAR-" + new Date().getTime().toString().slice(-4); 
    rowData[2] = usrNama;
    rowData[3] = usrNama + "@internal.com";
    rowData[4] = hashedPassword; 
    rowData[5] = "-"; 
    rowData[6] = "-"; 
    rowData[7] = "Aktif"; 
    rowData[8] = finalRole; 
    
    try { 
        await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'add_master', token: localStorage.getItem('pos_token'), sheetName: 'User Login', rowData: rowData }) }); 
        showToast("Akses Karyawan Baru Berhasil Dibuat!", "success"); 
        document.getElementById('formUserBaru').reset(); 
    } catch (e) { showToast("Gagal Terhubung ke Server", "error"); } finally { btn.innerHTML = oriText; btn.disabled = false; }
});

// PELANGGAN KILAT
window.bukaModalPelangganCepat = () => { document.getElementById('modalPelangganCepat').classList.remove('hidden'); setTimeout(() => document.getElementById('modalPelangganCepat').classList.remove('opacity-0'), 10); };
window.tutupModalPelangganCepat = () => { document.getElementById('modalPelangganCepat').classList.add('opacity-0'); setTimeout(() => document.getElementById('modalPelangganCepat').classList.add('hidden'), 300); };
document.getElementById('formPelangganCepat')?.addEventListener('submit', async (e) => { 
    e.preventDefault(); 
    const btn = document.getElementById('btnSimpanPelangganCepat'); let ori = btn.innerHTML; btn.innerHTML = 'Menyimpan...'; btn.disabled = true; 
    let nm = document.getElementById('pelCepatNama').value; 
    let alamat = document.getElementById('pelCepatAlamat').value || "-";
    let rowData = ["CUST-"+new Date().getTime(), nm, document.getElementById('pelCepatWA').value, "-", alamat, "-", "-", "Aktif"]; 
    try { 
        await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'add_master', token:localStorage.getItem('pos_token'), sheetName:'Pelanggan', rowData:rowData }) }); 
        document.getElementById('inputPelanggan').value = nm; 
        tutupModalPelangganCepat(); 
        showToast("Pelanggan ditambahkan!"); 
        document.getElementById('formPelangganCepat').reset(); 
        window.muatTabelPelanggan(); 
    } catch(e){} finally{ btn.innerHTML=ori; btn.disabled=false; } 
});

// =========================================================================================
// 10. LAPORAN SUPER DETAIL (FILTER TGL/BLN/THN, OMZET, KAS, LOG ALL HP & LEADERBOARD)
// =========================================================================================
async function muatLaporan() { 
    try { 
        const [resTrans, resUang] = await Promise.all([
            fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_master', token: localStorage.getItem('pos_token'), sheetName: 'Transaksi' }) }),
            fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_master', token: localStorage.getItem('pos_token'), sheetName: 'Keuangan' }) })
        ]);
        
        const resultTrans = await resTrans.json(); 
        const resultUang = await resUang.json();
        
        if (resultTrans.status && resultUang.status) { 
            let dataTrans = resultTrans.data || []; let dataUang = resultUang.data || [];
            let filterTgl = document.getElementById('filterTanggalLaporan')?.value || "Semua"; let filterBln = document.getElementById('filterBulanLaporan')?.value || "Semua"; let filterThn = document.getElementById('filterTahunLaporan')?.value || new Date().getFullYear().toString();
            let totalTrx = 0; let totalOmzet = 0; let totalLaba = 0; let totalPengeluaran = 0;
            
            const tbodyDetail = document.getElementById('tabelLapDetailBody'); const tbodyPengeluaran = document.getElementById('tabelLapPengeluaranBody'); const tbodyLeaderboard = document.getElementById('tabelLeaderboardBody');
            if(tbodyDetail) tbodyDetail.innerHTML = ''; if(tbodyPengeluaran) tbodyPengeluaran.innerHTML = '';
            let adaTransaksi = false; let adaPengeluaran = false; let cashierPerformance = {}; 
            
            const getParsedDate = (dStr) => {
                if(!dStr) return null; let s = String(dStr);
                let dObj = new Date(s);
                if(!isNaN(dObj.getTime()) && s.includes('T')) return { y: String(dObj.getFullYear()), m: String(dObj.getMonth()+1).padStart(2,'0'), d: String(dObj.getDate()).padStart(2,'0') };
                if(s.includes('-')) { let p = s.split('T')[0].split('-'); if(p.length===3) return { y: p[0].length===4?p[0]:p[2], m: p[1].padStart(2,'0'), d: p[0].length===4?p[2].substring(0,2):p[0] }; }
                if(s.includes('/')) { let p = s.split(' ')[0].split('/'); if(p.length===3) return { y: p[2].length===4?p[2]:p[0], m: p[1].padStart(2,'0'), d: p[2].length===4?p[0].padStart(2,'0'):p[2] }; }
                return null;
            };
            
            let htmlTrx = '';
            dataTrans.forEach(item => {
                let dtInfo = getParsedDate(item[13] || item[2]); 
                if(!dtInfo) return; let y = dtInfo.y, m = dtInfo.m, d = dtInfo.d;
                let isMatch = true; if(filterTgl !== "Semua" && d !== filterTgl) isMatch = false; if(filterBln !== "Semua" && m !== filterBln) isMatch = false; if(filterThn !== "Semua" && y !== filterThn) isMatch = false;
                if(isMatch) {
                    totalTrx++; totalOmzet += parseFloat(item[10]) || 0; totalLaba += parseFloat(item[15]) || 0;
                    let namaKasir = item[4] || 'Admin'; if(!cashierPerformance[namaKasir]) cashierPerformance[namaKasir] = { nota: 0, omzet: 0 }; cashierPerformance[namaKasir].nota += 1; cashierPerformance[namaKasir].omzet += parseFloat(item[10]) || 0;
                    if(tbodyDetail) { adaTransaksi = true; htmlTrx += `<tr class="hover:bg-slate-50 border-b border-gray-50"><td class="py-3 px-5 text-[10px] font-bold text-gray-500">${d}-${m}-${y}</td><td class="py-3 px-5 font-black text-gray-800">${item[4]}<br><span class="text-[9px] font-bold text-gray-400 font-mono tracking-widest">${item[1]}</span></td><td class="py-3 px-5 font-bold text-gray-500 text-[10px] uppercase tracking-widest"><span class="bg-gray-100 px-2.5 py-1 rounded-md">${item[9] || 'Cash'}</span></td><td class="py-3 px-5 text-right font-black text-indigo-600">${formatRp(item[10])}</td><td class="py-3 px-5 text-right font-bold text-emerald-500">+${formatRp(item[15]||0)}</td></tr>`; }
                }
            });
            if(tbodyDetail) tbodyDetail.innerHTML = htmlTrx;

            if(tbodyLeaderboard) {
                let sortedKasir = Object.keys(cashierPerformance).map(k => ({ nama: k, data: cashierPerformance[k] })).sort((a, b) => b.data.omzet - a.data.omzet); tbodyLeaderboard.innerHTML = '';
                if(sortedKasir.length === 0) tbodyLeaderboard.innerHTML = `<tr><td colspan="3" class="text-center py-8 text-amber-600/50 font-bold uppercase tracking-widest text-[10px]">Belum Ada Data</td></tr>`;
                sortedKasir.forEach((k, index) => { let rankIcon = index === 0 ? '<i class="fa-solid fa-medal text-amber-500 mr-2"></i>' : `<span class="text-gray-400 mr-2">#${index+1}</span>`; tbodyLeaderboard.innerHTML += `<tr class="border-b border-amber-100/50 hover:bg-amber-100/30 transition-colors"><td class="py-3 px-2 font-black">${rankIcon}${k.nama}</td><td class="py-3 px-2 text-center text-xs"><span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md">${k.data.nota}x</span></td><td class="py-3 px-2 text-right font-black text-indigo-600">${formatRp(k.data.omzet)}</td></tr>`; });
            }

            let totalPengeluaranHangus = 0;
            let htmlPeng = '';

            dataUang.forEach(item => {
                let dtInfo = getParsedDate(item[1]);
                if(!dtInfo) return; let y = dtInfo.y, m = dtInfo.m, d = dtInfo.d; let isMatch = true;
                if(filterTgl !== "Semua" && d !== filterTgl) isMatch = false; if(filterBln !== "Semua" && m !== filterBln) isMatch = false; if(filterThn !== "Semua" && y !== filterThn) isMatch = false;

                if(isMatch) {
                    let nominal = parseFloat(item[3]) || 0;
                    let kategori = String(item[2]);
                    totalPengeluaran += nominal; 
                    if (!kategori.includes("Kulakan") && !kategori.includes("Bekas (TT)") && !kategori.includes("Beli Aksesoris")) {
                        totalPengeluaranHangus += nominal;
                    }

                    if(tbodyPengeluaran) { 
                        adaPengeluaran = true; 
                        let isAset = kategori.includes("Kulakan") || kategori.includes("Bekas") || kategori.includes("Beli");
                        let badgeColor = isAset ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "bg-gray-100 text-gray-700";
                        htmlPeng += `<tr class="hover:bg-slate-50 border-b border-gray-50"><td class="py-3 px-5 text-[10px] font-bold text-gray-500">${d}-${m}-${y}</td><td class="py-3 px-5 font-semibold text-gray-700 text-xs"><span class="${badgeColor} px-2 py-0.5 rounded text-[9px] uppercase tracking-widest mr-2">${kategori}</span><br><span class="text-[10px] text-gray-500">${item[4]}</span></td><td class="py-3 px-5 text-right font-black text-rose-500">-${formatRp(nominal)}</td></tr>`; 
                    }
                }
            });
            if(tbodyPengeluaran) tbodyPengeluaran.innerHTML = htmlPeng;
            
            let labaBersih = totalLaba - totalPengeluaranHangus;
            
            document.getElementById('lapTransaksi').textContent = totalTrx; 
            document.getElementById('lapOmzet').textContent = formatRp(totalOmzet); 
            document.getElementById('lapPengeluaran').textContent = formatRp(totalPengeluaran); 
            document.getElementById('lapLaba').textContent = formatRp(labaBersih); 
            
            if(!adaTransaksi && tbodyDetail) tbodyDetail.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-[10px]">Kosong</td></tr>`;
            if(!adaPengeluaran && tbodyPengeluaran) tbodyPengeluaran.innerHTML = `<tr><td colspan="3" class="text-center py-10 text-gray-400 font-bold uppercase tracking-widest text-[10px]">Kosong</td></tr>`;

            if(document.getElementById('chartPenjualan')) { 
                if(grafikPenjualan) grafikPenjualan.destroy(); 
                grafikPenjualan = new Chart(document.getElementById('chartPenjualan').getContext('2d'), { 
                    type: 'bar', 
                    data: { 
                        labels: ['Omzet Masuk', 'Semua Kas Keluar', 'Laba Bersih (Real)'], 
                        datasets: [{ label: 'Nominal Rupiah', data: [totalOmzet, totalPengeluaran, labaBersih], backgroundColor: ['#4f46e5', '#f43f5e', '#10b981'], borderRadius: 10 }] 
                    }, 
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } 
                }); 
            } 
        } 
    } catch (e) {} 
}

// =========================================================================================
// 11. FINANCE DASHBOARD & NERACA KEKAYAAN
// =========================================================================================
async function kalkulasiKeuanganDashboard() {
    try {
        if(document.getElementById('infoTotalModal')) document.getElementById('infoTotalModal').innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xl opacity-50"></i>';
        if(document.getElementById('infoSaldoAkhir')) document.getElementById('infoSaldoAkhir').innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xl opacity-50"></i>';
        if(document.getElementById('infoTotalAset')) document.getElementById('infoTotalAset').innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xl opacity-50"></i>';
        if(document.getElementById('infoKekayaan')) document.getElementById('infoKekayaan').innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xl opacity-50"></i>';

        const res = await fetch(API_URL, { 
            method: 'POST', 
            body: JSON.stringify({ action: 'get_dashboard_keuangan', token: localStorage.getItem('pos_token') }) 
        });
        
        const result = await res.json();
        
        if(result.status && result.data) {
            let d = result.data;
            let totalKekayaan = d.saldoTunai + d.nilaiAsetBarang;
            
            if(document.getElementById('infoTotalModal')) document.getElementById('infoTotalModal').innerText = formatRp(d.modalMasuk);
            if(document.getElementById('infoSaldoAkhir')) document.getElementById('infoSaldoAkhir').innerText = formatRp(d.saldoTunai);
            if(document.getElementById('infoTotalAset')) document.getElementById('infoTotalAset').innerText = formatRp(d.nilaiAsetBarang);
            if(document.getElementById('infoKekayaan')) document.getElementById('infoKekayaan').innerText = formatRp(totalKekayaan);
            
            if(document.getElementById('infoBelanjaStok')) document.getElementById('infoBelanjaStok').innerText = "- " + formatRp(d.pengeluaranAset);
            if(document.getElementById('infoBiayaOps')) document.getElementById('infoBiayaOps').innerText = "- " + formatRp(d.pengeluaranBiaya);
            if(document.getElementById('infoPrive')) document.getElementById('infoPrive').innerText = "- " + formatRp(d.priveKeluar);
            if(document.getElementById('infoOmzetMasuk')) document.getElementById('infoOmzetMasuk').innerText = "+ " + formatRp(d.omzetMasuk);
            if(document.getElementById('infoOmzetBarang')) document.getElementById('infoOmzetBarang').innerText = "+ " + formatRp(d.omzetBarang);
            if(document.getElementById('infoOmzetService')) document.getElementById('infoOmzetService').innerText = "+ " + formatRp(d.omzetService);
        } else {
            showToast("Gagal memuat kalkulasi dashboard.", "error");
        }
    } catch(e) {}
}

// =========================================================================================
// 12. AUDIT OPNAME GUDANG
// =========================================================================================
async function mulaiOpname() {
    const btn = document.getElementById('btnMulaiOpname'); btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat Data Gudang...'; btn.disabled = true;
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_barang', token: localStorage.getItem('pos_token') }) });
        const result = await res.json();
        if(result.status) { dataOpnameAktif = result.data; renderLembarOpname(); document.getElementById('btnSubmitOpname').disabled = false; showToast("Lembar Kerja Audit Dibuka", "success"); }
    } catch(e) { showToast("Gagal memuat barang", "error"); }
    btn.innerHTML = '<i class="fa-solid fa-clipboard-check"></i> Mulai Audit Hari Ini'; btn.disabled = false;
}

function renderLembarOpname() {
    const tbody = document.getElementById('tabelInputOpname'); tbody.innerHTML = '';
    let htmlString = '';
    dataOpnameAktif.forEach((b, i) => {
        let infoImei = (b.imei && b.imei !== '-') ? `<br><span class="text-[9px] font-bold text-indigo-500 font-mono tracking-widest">IMEI: ${b.imei}</span>` : '';
        
        htmlString += `
        <tr class="opname-row border-b border-gray-100 hover:bg-slate-50 transition-colors">
            <td class="py-3 px-4"><p class="font-black text-gray-800 leading-tight w-48 truncate" title="${b.namaBarang}">${b.namaBarang}</p><p class="text-[9px] text-gray-400 font-mono tracking-widest mt-1">SKU: ${b.sku}${infoImei}</p></td>
            <td class="py-3 px-4 text-center font-black text-indigo-600 text-lg" id="stok_sys_${i}">${b.stok}</td>
            <td class="py-3 px-4 text-center"><input type="number" id="stok_fisik_${i}" oninput="hitungSelisih(${i})" value="${b.stok}" class="w-16 px-2 py-2 border border-gray-300 rounded-lg text-center font-black focus:ring-2 focus:ring-emerald-500 outline-none text-lg bg-gray-50"></td>
            <td class="py-3 px-4 text-center font-black text-gray-300 text-lg" id="selisih_${i}">0</td>
            <td class="py-3 px-4"><input type="text" id="ket_${i}" placeholder="Tulis alasan jika selisih..." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-amber-500 outline-none"></td>
        </tr>`;
    });
    tbody.innerHTML = htmlString;
}

window.hitungSelisih = function(i) {
    let sys = parseInt(document.getElementById(`stok_sys_${i}`).innerText); let fis = parseInt(document.getElementById(`stok_fisik_${i}`).value); if (isNaN(fis)) fis = 0;
    let selisih = fis - sys; let el = document.getElementById(`selisih_${i}`); el.innerText = selisih > 0 ? `+${selisih}` : selisih;
    if(selisih < 0) { el.className = "py-3 px-4 text-center font-black text-rose-500 text-lg"; document.getElementById(`ket_${i}`).placeholder = "Wajib isi alasan kurang!"; }
    else if(selisih > 0) { el.className = "py-3 px-4 text-center font-black text-amber-500 text-lg"; document.getElementById(`ket_${i}`).placeholder = "Darimana stok berlebih ini?"; }
    else { el.className = "py-3 px-4 text-center font-black text-gray-300 text-lg"; document.getElementById(`ket_${i}`).placeholder = "Aman"; }
}

window.filterTableOpname = function() {
    let val = document.getElementById('cariOpname').value.toLowerCase();
    document.querySelectorAll('.opname-row').forEach(row => { let text = row.cells[0].innerText.toLowerCase(); row.style.display = text.includes(val) ? '' : 'none'; });
}

window.simpanOpname = async function() {
    const btn = document.getElementById('btnSubmitOpname'); btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses Audit & Update Database...'; btn.disabled = true;
    let payload = []; let user = localStorage.getItem('pos_username') || 'Admin';
    
    dataOpnameAktif.forEach((b, i) => {
        let sys = parseInt(document.getElementById(`stok_sys_${i}`).innerText); let fis = parseInt(document.getElementById(`stok_fisik_${i}`).value); if (isNaN(fis)) fis = 0;
        let selisih = fis - sys; let ket = document.getElementById(`ket_${i}`).value;
        if(selisih !== 0 || ket !== "") { payload.push({ sku: b.sku, namaBarang: b.namaBarang, stokSistem: sys, stokFisik: fis, selisih: selisih, keterangan: ket || (selisih === 0 ? "Aman" : "Ada Selisih"), user: user }); }
    });
    
    if(payload.length === 0) { 
        payload.push({ sku: "ALL-SAFE", namaBarang: "Semua Stok Barang Cocok", stokSistem: "Aman", stokFisik: "Aman", selisih: 0, keterangan: "Tidak ada barang yang hilang/selisih", user: user }); 
    }
    
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'proses_opname', token: localStorage.getItem('pos_token'), payload: payload }) });
        const result = await res.json();
        if(result.status) { showToast("Audit Selesai & Tercatat!", "success"); document.getElementById('tabelInputOpname').innerHTML = `<tr><td colspan="5" class="text-center py-10 font-bold text-gray-400 uppercase tracking-widest text-xs">Audit Selesai</td></tr>`; muatTabelOpnameHistory(); muatKatalogBarang(); } else { showToast(result.message, "error"); }
    } catch(e) { showToast("Gagal memproses audit", "error"); btn.disabled = false; } finally { btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Terapkan Audit & Update Database'; }
}

// =========================================================================================
// 13. HRD ABSENSI KAMERA & PENGAJUAN APPROVAL
// =========================================================================================
function updateStatusAbsen() { const statusDiv = document.getElementById('statusAbsenHariIni'); const btnM = document.getElementById('btnAbsenMasuk'); const btnP = document.getElementById('btnAbsenPulang'); const tglHariIni = new Date().toLocaleDateString('id-ID'); const lastMasuk = localStorage.getItem('absen_masuk_' + tglHariIni); const lastPulang = localStorage.getItem('absen_pulang_' + tglHariIni); if (lastPulang) { statusDiv.innerHTML = `<i class="fa-solid fa-check-double mr-2"></i> Selesai Shift`; statusDiv.className = "w-full text-center text-xs font-black uppercase tracking-widest bg-emerald-100 text-emerald-700 py-3 rounded-xl mb-6 shadow-sm"; if(btnM) btnM.disabled = true; if(btnP) btnP.disabled = true; } else if (lastMasuk) { statusDiv.innerHTML = `<i class="fa-solid fa-briefcase mr-2"></i> Sedang Bekerja`; statusDiv.className = "w-full text-center text-xs font-black uppercase tracking-widest bg-blue-100 text-blue-700 py-3 rounded-xl mb-6 shadow-sm"; if(btnM) btnM.disabled = true; if(btnP) btnP.disabled = false; } else { statusDiv.innerHTML = `<i class="fa-solid fa-clock mr-2"></i> Belum Absen Masuk`; statusDiv.className = "w-full text-center text-xs font-black uppercase tracking-widest bg-amber-100 text-amber-700 py-3 rounded-xl mb-6 shadow-sm"; if(btnM) btnM.disabled = false; if(btnP) btnP.disabled = true; } }
async function mulaiKameraAbsensi() { const video = document.getElementById('kameraAbsen'); const status = document.getElementById('statusKamera'); const txtLokasi = document.getElementById('txtLokasiAbsen'); try { streamKamera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }); video.srcObject = streamKamera; navigator.geolocation.getCurrentPosition((pos) => { kordinatGPS = pos.coords.latitude + ", " + pos.coords.longitude; txtLokasi.innerHTML = `<i class="fa-solid fa-location-crosshairs text-indigo-500 mr-2"></i> GPS Terkunci. Siap Absen.`; if(status) status.classList.add('hidden'); updateStatusAbsen(); }, (err) => { txtLokasi.innerHTML = `<i class="fa-solid fa-location-dot text-rose-500 mr-2"></i> GPS Gagal. Absen Tanpa Lokasi.`; if(status) status.classList.add('hidden'); updateStatusAbsen(); }); } catch (e) { if(status) status.innerHTML = `<p class="text-sm font-black tracking-widest uppercase text-rose-400">Akses Kamera Ditolak</p>`; } }
function matikanKameraAbsensi() { if (streamKamera) { streamKamera.getTracks().forEach(track => track.stop()); streamKamera = null; const status = document.getElementById('statusKamera'); if(status) status.classList.remove('hidden'); } }

async function prosesAbsensiKamera(jenis) { 
    const btnM = document.getElementById('btnAbsenMasuk'); const btnP = document.getElementById('btnAbsenPulang'); btnM.disabled = true; btnP.disabled = true; showToast(`Memproses Absen...`); 
    const canvas = document.getElementById('canvasAbsen'); const video = document.getElementById('kameraAbsen'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); 
    let row = new Array(30).fill("-"); row[0] = "ABS-" + new Date().getTime(); row[1] = localStorage.getItem('pos_username') || "Karyawan"; row[2] = new Date().toLocaleString('id-ID'); row[3] = jenis; row[4] = kordinatGPS; row[5] = canvas.toDataURL('image/jpeg', 0.5); row[7] = "Hadir"; 
    try { await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'add_master', token: localStorage.getItem('pos_token'), sheetName: 'Absensi', rowData: row }) }); showToast(`Absen ${jenis} Sukses!`); const tglHariIni = new Date().toLocaleDateString('id-ID'); if(jenis === 'Masuk') localStorage.setItem('absen_masuk_' + tglHariIni, 'true'); if(jenis === 'Pulang') localStorage.setItem('absen_pulang_' + tglHariIni, 'true'); updateStatusAbsen(); muatTabelAbsensi(); } catch (e) { showToast("Gagal Absen", "error"); updateStatusAbsen(); } 
}

document.getElementById('formPengajuanAbsen')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = document.getElementById('btnSubmitPengajuan'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...'; let row = new Array(30).fill("-"); row[0] = "ABS-" + new Date().getTime(); row[1] = localStorage.getItem('pos_username') || "Karyawan"; row[2] = new Date().toLocaleString('id-ID'); row[3] = document.getElementById('ajuJenis').value; row[4] = document.getElementById('ajuTanggal').value; row[5] = document.getElementById('ajuKeterangan').value; row[7] = "Pending";
    try { await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'add_master', token: localStorage.getItem('pos_token'), sheetName: 'Absensi', rowData: row }) }); showToast("Pengajuan dikirim!", "success"); document.getElementById('formPengajuanAbsen').reset(); muatTabelAbsensi(); } catch (err) { showToast("Gagal mengirim pengajuan", "error"); } finally { btn.disabled = false; btn.innerHTML = "Kirim Pengajuan ke Owner"; }
});

async function muatTabelAbsensi() {
    const tbody = document.getElementById('tabelAbsensiBody'); if(!tbody) return; tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 font-bold text-indigo-500 uppercase tracking-widest text-[10px]">Loading Data...</td></tr>`;
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'get_master', token: localStorage.getItem('pos_token'), sheetName: 'Absensi' }) }); const result = await res.json();
        if(result.status) {
            let rawData = result.data.reverse(); 
            let fBulan = document.getElementById('filterBulanAbsen') ? document.getElementById('filterBulanAbsen').value : 'Semua';
            let fTahun = document.getElementById('filterTahunAbsen') ? document.getElementById('filterTahunAbsen').value : 'Semua';
            
            let filteredData = rawData.filter(item => {
                let tglDB = item[2]; if(!tglDB) return false;
                let strDate = String(tglDB).split(' ')[0]; let arrTgl;
                if (strDate.includes('-')) { let parts = strDate.split('-'); if(parts[0].length === 4) arrTgl = [parts[0], parts[1], parts[2]]; else arrTgl = [parts[2], parts[1], parts[0]]; } 
                else if (strDate.includes('/')) { let parts = strDate.split('/'); arrTgl = [parts[2].substring(0,4), (parts[1].length===1?'0'+parts[1]:parts[1]), (parts[0].length===1?'0'+parts[0]:parts[0])]; }
                if(!arrTgl) return true;
                
                let m = arrTgl[1]; let y = arrTgl[0];
                let matchBulan = (fBulan === 'Semua') || (m === fBulan);
                let matchTahun = (fTahun === 'Semua') || (y === fTahun);
                return matchBulan && matchTahun;
            });
            
            let data = filteredData.slice(0, 500); // Tampilkan 500 data untuk di-export Excel
            let adaData = false;
            const role = localStorage.getItem('pos_role') || ''; const uname = localStorage.getItem('pos_username') || ''; 
            const isOwner = role.toLowerCase().includes('admin') || role.toLowerCase().includes('owner') || uname.toLowerCase() === 'owner' || role === '';
            if(!isOwner && document.getElementById('thAksiApproval')) document.getElementById('thAksiApproval').style.display = 'none';

            let htmlString = '';
            data.forEach(item => {
                adaData = true;
                let isPengajuan = ['Izin Keperluan', 'Sakit', 'Offday', 'Terlambat', 'Lupa Absen'].includes(item[3]);
                
                let statusBadge = '';
                if(item[7] === 'Hadir') statusBadge = 'bg-blue-100 text-blue-700 border-blue-200';
                else if(item[7] === 'Approved') statusBadge = 'bg-emerald-100 text-emerald-700 border-emerald-200';
                else if(item[7] === 'Rejected') statusBadge = 'bg-rose-100 text-rose-700 border-rose-200';
                else statusBadge = 'bg-amber-100 text-amber-700 border-amber-200 animate-pulse';
                
                let trIcon = '';
                if(item[3] === 'Masuk') trIcon = '<i class="fa-solid fa-arrow-right-to-bracket text-emerald-500 mr-2"></i>';
                else if(item[3] === 'Pulang') trIcon = '<i class="fa-solid fa-arrow-right-from-bracket text-rose-500 mr-2"></i>';
                else if(item[3] === 'Sakit') trIcon = '<i class="fa-solid fa-briefcase-medical text-rose-400 mr-2"></i>';
                else trIcon = '<i class="fa-solid fa-calendar-xmark text-indigo-400 mr-2"></i>';
                
                let infoDetail = isPengajuan ? item[5] : `<span class="text-[9px]"><i class="fa-solid fa-location-dot text-indigo-400 mr-1"></i> GPS: ${item[4]}</span>`;
                let wkt = item[2]; 
                
                let actionHtml = '';
                if(isOwner) { 
                    if(item[7] === 'Pending') { 
                        actionHtml = `<td class="py-3 px-6 text-center"><button onclick="approveAbsenKaryawan('${item[0]}', 'Approved')" class="text-emerald-600 bg-emerald-50 hover:bg-emerald-500 hover:text-white px-3 py-1.5 rounded-lg mr-2 text-[10px] font-black uppercase tracking-widest transition-colors shadow-sm">ACC</button><button onclick="approveAbsenKaryawan('${item[0]}', 'Rejected')" class="text-rose-600 bg-rose-50 hover:bg-rose-500 hover:text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors shadow-sm">Tolak</button></td>`; 
                    } else if(isPengajuan) {
                        actionHtml = `<td class="py-3 px-6 text-center text-[10px] font-bold text-gray-300 tracking-widest"><i class="fa-solid fa-lock mr-1"></i> Terkunci</td>`;
                    } else {
                        actionHtml = `<td class="py-3 px-6 text-center text-[10px] font-bold text-blue-400 tracking-widest"><i class="fa-solid fa-check-double mr-1"></i> Auto</td>`;
                    }
                }
                
                htmlString += `<tr class="border-b border-gray-50 hover:bg-slate-50 transition-colors"><td class="py-3 px-6 text-[10px] font-bold text-gray-500 tracking-wider">${wkt}</td><td class="py-3 px-6 font-black text-gray-800">${item[1]}</td><td class="py-3 px-6 font-bold text-gray-600 text-xs">${trIcon}${item[3]}</td><td class="py-3 px-6 text-xs text-gray-500 font-medium truncate max-w-[150px]">${infoDetail}</td><td class="py-3 px-6 text-center"><span class="px-3 py-1.5 rounded-md border text-[9px] font-black uppercase tracking-widest ${statusBadge}">${item[7]}</span></td>${isOwner ? actionHtml : ''}</tr>`;
            });
            tbody.innerHTML = htmlString;
            if(!adaData) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Belum ada riwayat absensi</td></tr>`;
        }
    } catch(e) {}
}

// Eksekusi Instan saat Aplikasi Dimuat
checkSession();

// =========================================================================================
// FUNGSI DOWNLOAD EXCEL (REVISI: MURNI CSV UNTUK KOLOM RAPI)
// =========================================================================================
function downloadExcel(tableId, filename) { 
    let table = document.getElementById(tableId); 
    if (!table) return showToast("Tabel tidak ditemukan", "error"); 
    
    let csvContent = "";
    let rows = table.querySelectorAll('tr');
    
    rows.forEach(row => {
        if(row.style.display === 'none') return;
        let rowData = [];
        let isThead = row.parentNode.tagName === 'THEAD';
        let cells = row.querySelectorAll('th, td');
        
        cells.forEach((cell, index) => {
            let headerText = '';
            if(!isThead) {
                let th = table.querySelector(`thead th:nth-child(${index + 1})`);
                if(th) headerText = th.innerText.toLowerCase();
            } else {
                headerText = cell.innerText.toLowerCase();
            }
            
            // Otomatis buang kolom tabel "Aksi" atau "Tindakan"
            if(headerText.includes('aksi') || headerText.includes('print') || headerText.includes('tindakan')) return;
            
            // Bersihkan teks: hilangkan baris baru, ganti koma dengan titik (untuk uang)
            let cellText = cell.innerText.trim()
                .replace(/\n/g, ' - ') // Jadikan spasi agar tak merusak CSV
                .replace(/"/g, '""'); // Escape tanda kutip ganda
                
            rowData.push('"' + cellText + '"'); // Bungkus setiap sel dengan kutip agar aman
        });
        // Gunakan Titik Koma (;) agar langsung terpisah per kolom di Excel Indonesia
        csvContent += rowData.join(";") + "\n";
    });

    let blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' }); 
    let url = URL.createObjectURL(blob); let a = document.createElement("a"); a.href = url; 
    a.download = filename + "_" + new Date().toLocaleDateString('id-ID').replace(/\//g, '-') + ".csv"; 
    document.body.appendChild(a); a.click(); 
    setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100); 
    showToast("File Excel berhasil dirapikan & di-download!", "success"); 
}

// KHUSUS: Membuat lembar kertas ceklis opname yang bersih dari element form input
window.downloadLembarOpnameKertas = function() {
    if (dataOpnameAktif.length === 0) {
        return showToast("Klik 'Mulai Audit Hari Ini' dulu untuk memuat data!", "error");
    }

    let tgl = new Date().toLocaleDateString('id-ID');
    let htmlClean = `<table border="1" style="border-collapse:collapse; width:100%; font-family:sans-serif; font-size:12px;">`;
    htmlClean += `<tr><th colspan="6" style="text-align:left; font-size:16px; padding:10px;">LEMBAR CEKLIS STOK OPNAME - TANGGAL: ${tgl}</th></tr>`;
    htmlClean += `<tr><th style="padding:5px;">SKU / KODE BARANG</th><th style="padding:5px;">IMEI / SN</th><th style="padding:5px;">NAMA BARANG</th><th style="padding:5px;">STOK SISTEM</th><th style="padding:5px;">[ ] FISIK NYATA</th><th style="padding:5px;">CATATAN KARYAWAN</th></tr>`;
    
    dataOpnameAktif.forEach(b => {
        let imeiText = (b.imei && b.imei !== '-') ? b.imei : '-';
        htmlClean += `<tr>`;
        htmlClean += `<td style="padding:5px;mso-number-format:'\@';">${b.sku}</td>`;
        htmlClean += `<td style="padding:5px; font-family:monospace; font-weight:bold; mso-number-format:'\@';">${imeiText}</td>`;
        htmlClean += `<td style="padding:5px;">${b.namaBarang}</td>`;
        htmlClean += `<td style="padding:5px; text-align:center;"><b>${b.stok}</b></td>`;
        htmlClean += `<td style="padding:5px; text-align:center; width:100px;"></td>`; 
        htmlClean += `<td style="padding:5px; width:200px;"></td>`;
        htmlClean += `</tr>`;
    });
    
    htmlClean += `</table>`;
    
    let dataFormat = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body>${htmlClean}</body></html>`; 
    let blob = new Blob(['\ufeff', dataFormat], { type: 'application/vnd.ms-excel' }); 
    let url = URL.createObjectURL(blob); let a = document.createElement("a"); a.href = url; 
    a.download = "Kertas_Ceklis_Opname_" + tgl.replace(/\//g, '-') + ".xls"; 
    document.body.appendChild(a); a.click(); 
    setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100); 
    showToast("Kertas Ceklis Opname berhasil didownload!", "success"); 
}

// =========================================================================================
// 14. SANSTECH PWA UPDATE NOTIFIER (DETEKSI VERSI BARU OTOMATIS)
// =========================================================================================
let newWorker;
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
            newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    munculkanBannerUpdate();
                }
            });
        });
    });

    let refreshing;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        window.location.reload();
        refreshing = true;
    });
}

function munculkanBannerUpdate() {
    const banner = document.createElement('div');
    banner.id = "pwaUpdateBanner";
    banner.className = "fixed top-0 left-0 w-full bg-gradient-to-r from-indigo-600 to-purple-700 text-white p-5 shadow-2xl z-[9999] flex flex-col md:flex-row items-center justify-between gap-4 transform -translate-y-full transition-transform duration-500 border-b-4 border-indigo-400";
    banner.innerHTML = `
        <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center shrink-0">
                <i class="fa-solid fa-cloud-arrow-down text-2xl animate-bounce"></i>
            </div>
            <div>
                <h4 class="font-black text-sm uppercase tracking-widest text-white">Update Sistem Tersedia!</h4>
                <p class="text-[10px] md:text-xs text-indigo-100 font-medium mt-1 leading-tight">SANSTECH Pusat telah merilis versi terbaru. Silakan update agar aplikasi berjalan maksimal dan fitur baru terbuka.</p>
            </div>
        </div>
        <button onclick="eksekusiUpdatePWA()" class="bg-white text-indigo-600 font-black px-8 py-3 rounded-xl text-xs uppercase tracking-widest shadow-xl hover:bg-gray-100 hover:scale-105 active:scale-95 transition-all shrink-0 w-full md:w-auto">Update Sekarang</button>
    `;
    document.body.appendChild(banner);
    setTimeout(() => banner.classList.remove('-translate-y-full'), 1000);
}

window.eksekusiUpdatePWA = function() {
    const btn = document.querySelector('#pwaUpdateBanner button');
    if(btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menginstal...'; btn.disabled = true; }
    if (newWorker) newWorker.postMessage('SKIP_WAITING');
}