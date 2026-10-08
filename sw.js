/* 備品管理システム：ホーム画面に追加できるようにするための最小のサービスワーカー。
   データ（Firestore）やAPIはキャッシュせず、画面（HTML・アイコン）だけを、
   通信できないときの代わりに表示する。通常は常に最新を取得する（ネットワーク優先）。 */
const CACHE = "bihin-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener("fetch", function(e){
  const req = e.request;
  const url = new URL(req.url);
  if(req.method !== "GET" || url.origin !== location.origin || url.pathname.indexOf("/api/") === 0) return; // 外部（Firebase等）・APIは対象外
  e.respondWith(
    fetch(req).then(function(res){
      if(res && res.ok){ const copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(hit){ return hit || (req.mode === "navigate" ? caches.match("/") : undefined); });
    })
  );
});
