// ==========================================
// YLY System - Service Worker (A4 Standard)
// ==========================================

const CACHE_VERSION = 'v3.0.0';
const CACHE_NAME = `yly-system-cache-${CACHE_VERSION}`;

// الأصول الأساسية المطلوبة للعمل بدون إنترنت شاملة أيقوناتك المحلية
const CORE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './tailwind.min.css',
    './styles.css',
    './app.js',
    './firebase-config.js',
    './admin.html',
    './form.html',
    './icons/icon-192.png',
    './icons/icon-512.png',
    'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap'
];

// 1. Install Event (تخزين الأصول الأساسية)
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[ServiceWorker] Caching App Shell');
            return Promise.all(
                CORE_ASSETS.map(url => {
                    return cache.add(url).catch(err => console.warn(`[SW] Skip caching ${url}:`, err));
                })
            );
        })
    );
});

// 2. Activate Event (تنظيف الكاش القديم لمنع التسريب)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName.startsWith('yly-system-cache-') && cacheName !== CACHE_NAME) {
                        console.log('[ServiceWorker] Removing old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. Fetch Event (التحكم في الطلبات والتخزين الآمن)
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // حماية 1: منع كاش طلبات غير GET أو طلبات Firebase نهائياً
    if (request.method !== 'GET' || 
        url.hostname.includes('firestore.googleapis.com') || 
        url.hostname.includes('firebase') || 
        url.hostname.includes('identitytoolkit')) {
        return;
    }

    // استراتيجية HTML: Network First مع العودة للكاش
    if (request.mode === 'navigate' || request.headers.get('accept').includes('text/html')) {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                    }
                    return networkResponse;
                })
                .catch(() => caches.match(request).then(res => res || caches.match('./index.html')))
        );
        return;
    }

    // استراتيجية الأصول الثابتة والمكتبات: Cache First
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;

            return fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                }
                return networkResponse;
            }).catch(() => {
                // تجاهل أخطاء الانقطاع للأصول الثانوية
            });
        })
    );
});