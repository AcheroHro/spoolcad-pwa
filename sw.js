const GHPATH = '/spoolcad-pwa';
const APP_PREFIX = 'spoolcad_';
const VERSION = 'version_01';
const URLS = [
  `${GHPATH}/`,
  `${GHPATH}/index.html`,
  `${GHPATH}/styles.css`,
  `${GHPATH}/app.js`,
  `${GHPATH}/manifest.json`
];

const CACHE_NAME = APP_PREFIX + VERSION;
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(URLS))));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));