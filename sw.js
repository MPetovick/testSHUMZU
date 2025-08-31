const CACHE_NAME = 'mapa-cache-v3';
const OFFLINE_TILE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="100%" height="100%" fill="lightgray"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="gray">Sin conexión</text></svg>';

const precacheResources = [
  '/',
  'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Instalación del Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(precacheResources);
      })
      .then(() => self.skipWaiting())
  );
});

// Activación del Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker activando...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Eliminando cache antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estrategia de cache: Cache First, con fallback a Network
self.addEventListener('fetch', event => {
  // Solo manejar peticiones GET
  if (event.request.method !== 'GET') return;

  // Para peticiones de tiles, usar estrategia específica
  if (event.request.url.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(response => {
          // Si está en cache, devolverlo
          if (response) {
            return response;
          }

          // Si no está en cache, buscar en red
          return fetch(event.request).then(networkResponse => {
            // Almacenar en cache para futuras peticiones
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          }).catch(error => {
            // Si falla la red, devolver tile offline
            return new Response(OFFLINE_TILE, {
              headers: { 'Content-Type': 'image/svg+xml' }
            });
          });
        });
      })
    );
  } else {
    // Para otros recursos, usar estrategia Network First
    event.respondWith(
      fetch(event.request).then(response => {
        // Clonar la respuesta para almacenarla en cache
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(error => {
        // Si falla la red, buscar en cache
        return caches.match(event.request);
      })
    );
  }
});

// Manejar mensajes desde la aplicación
self.addEventListener('message', event => {
  if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});
