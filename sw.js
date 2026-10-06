// 앱 파일을 캐시해서 오프라인에서도 동작하게 한다.
// 앱 코드를 수정하면 CACHE_VERSION을 올려야 설치된 앱이 새 파일을 받는다.
const CACHE_VERSION = 'my-bar-v4';
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  // 브라우저 HTTP 캐시(GitHub Pages는 10분)를 건너뛰고 서버에서 새로 받는다.
  const requests = APP_FILES.map(url => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(requests)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(hit => hit || fetch(event.request))
  );
});
