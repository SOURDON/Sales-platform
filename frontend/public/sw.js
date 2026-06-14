// Bump when shell caching logic changes.
const CACHE_NAME = 'sales-platform-v10'
const API_PATH_PREFIXES = ['/auth', '/admin', '/director', '/dashboard', '/health']

const PRECACHE_URLS = /*__PRECACHE__*/[]

const APP_SHELL = [
  '/',
  '/index.html',
  '/sw.js',
  '/manifest.webmanifest',
  '/app-icon.svg',
  '/favicon.svg',
  '/icons.svg',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
]

function isApiPath(pathname) {
  return API_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/assets/') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.webmanifest') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.woff2')
  )
}

self.addEventListener('install', (event) => {
  const urls = [...new Set([...APP_SHELL, ...PRECACHE_URLS])]
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          urls.map((url) =>
            cache.add(url).catch(() => {
              // Ignore missing optional assets during install.
            }),
          ),
        ),
      ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key)
          }
          return Promise.resolve(true)
        }),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) {
    return
  }

  if (isApiPath(requestUrl.pathname)) {
    event.respondWith(fetch(event.request))
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          }
          return response
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  if (!isStaticAsset(requestUrl.pathname)) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).catch(() => caches.match('/index.html')),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        .catch(() => null)

      if (cached) {
        void networkFetch
        return cached
      }

      return networkFetch.then((response) => response || caches.match('/index.html'))
    }),
  )
})
