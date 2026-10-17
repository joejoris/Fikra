/* FIKRA lite service worker — a small offline-first shell for repeat visitors.
 *
 * Strategy:
 * - API and other dynamic requests are never touched: they always go straight
 *   to the network. Caching them made signed-in state, chat, comments and
 *   direct messages look stale/broken.
 * - Navigation requests: network first; on failure serve the last-cached copy
 *   of the page (or the cached homepage as a fallback).
 * - Same-origin static assets (styles, scripts, images, fonts, manifest):
 *   stale-while-revalidate — show the cache immediately and refresh it in the
 *   background.
 * - Everything else (cross-origin, non-GET, JSON, XML): untouched.
 */

const VERSION = 'fikra-v2';
const CORE = ['/', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// Only same-origin, non-API GETs are eligible. Dynamic endpoints (the JSON API,
// sitemap/rss/ics, search index) must always hit the network.
function isCacheable(url) {
  return (
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    url.pathname !== '/sw.js' &&
    !/\.(json|xml|ics)$/i.test(url.pathname)
  );
}

const ASSET_DESTINATIONS = new Set(['style', 'script', 'image', 'font', 'manifest']);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isCacheable(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/')),
        ),
    );
    return;
  }

  // Leave anything that is not clearly a static asset (e.g. fetch() calls for
  // data) to the network untouched.
  if (!ASSET_DESTINATIONS.has(request.destination)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
