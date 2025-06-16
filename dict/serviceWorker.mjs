const CACHE_NAME = "offline-cache-v2";
const ASSETS = [
    "./",
    "./index.html",
    "./styles/index.css",
    "./buscadorDeTerminos.mjs",
    "./fuse.basic.min.mjs",
    "./favicon.png"
];

const noServerResponse = new Response(null, {status: 503, statusText: "Server not available."});

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request.url, {ignoreSearch: true}).then(response => response || fetch(event.request))
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
        .then(cacheNames => 
            Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            )
        )
    );
});