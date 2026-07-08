const CACHE_NAME = 'epp-megablessing-v2';
const ARCHIVOS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './js/xlsx.full.min.js',
  './js/jspdf.umd.min.js',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache=>cache.addAll(ARCHIVOS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e)=>{
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached) return cached;
      return fetch(e.request).then(resp=>{
        return caches.open(CACHE_NAME).then(cache=>{
          if(e.request.method==='GET' && resp.status===200){
            cache.put(e.request, resp.clone());
          }
          return resp;
        });
      }).catch(()=> cached);
    })
  );
});
