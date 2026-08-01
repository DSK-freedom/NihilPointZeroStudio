/**
 * Offline shell for the NihilPointZero phone app.
 *
 * Caches only the app's own files so the icon opens instantly and shows a clear
 * message when there is no signal. AI requests are never cached — an answer is
 * always generated fresh, and a stale one would be worse than none.
 *
 * Bump CACHE when the shell changes so old phones pick up the new version.
 */
const CACHE = 'npz-phone-v1'
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individual misses must not fail the whole install, or one 404 leaves the
      // app permanently uninstallable.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Only ever serve our own origin from cache; AI calls go straight to the network.
  if (url.origin !== self.location.origin) return

  event.respondWith(
    // Network first, so a shipped fix reaches the phone on the next open, with the
    // cache as the offline safety net.
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined)
        return res
      })
      .catch(async () => {
        const hit = await caches.match(req)
        if (hit) return hit
        const shell = await caches.match('./index.html')
        if (shell) return shell
        return new Response('You are offline, and NihilPointZero has not been saved to this phone yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      })
  )
})
