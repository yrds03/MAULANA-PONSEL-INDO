const CACHE_NAME = 'maulana-pos-v38';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './1002225610.jpg'
];

// Install Service Worker dan simpan file ke cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Hapus cache lama jika ada versi baru
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Ambil dari cache jika offline, jika tidak fetch dari network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
// FITUR SANSTECH: Mendengarkan perintah dari web untuk memaksa update Service Worker
self.addEventListener('message', function(event) {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
