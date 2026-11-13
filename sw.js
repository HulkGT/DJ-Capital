// DJ Capital – Offline-Speicher. Bei jedem Update die Versionsnummer erhöhen.
const VERSION='djc-1.15.0';
const SHELL=['./','index.html','app.js','style.css','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','lib/pdf.min.js','lib/pdf.worker.min.js','sc-upload.png','sc-beleg.png','sc-ausgabe.png','sc-miete.png','privacy.html','terms.html','config.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==VERSION).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);
  // Bank-Vermittler und andere fremde Adressen nie zwischenspeichern
  if(u.origin!==location.origin){if(!/^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname))return;e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{const c=res.clone();caches.open(VERSION).then(x=>x.put(r,c));return res}).catch(()=>m)));return}
  // eigene Dateien: erst Netz (für Updates), sonst Offline-Kopie
  e.respondWith(fetch(r,{cache:'no-cache'}).then(res=>{const c=res.clone();caches.open(VERSION).then(x=>x.put(r,c));return res}).catch(()=>caches.match(r).then(m=>m||caches.match('index.html'))));
});
// Mitteilungen: Der Server schickt nur ein Signal ohne Inhalt, die App holt die Rechnung dann verschlüsselt ab.
self.addEventListener('push',e=>{e.waitUntil((async()=>{
  const L=await self.clients.matchAll({type:'window',includeUncontrolled:true});L.forEach(c=>c.postMessage({t:'bill'}));
  await self.registration.showNotification('My Capital',{body:'Neue Rechnung eingegangen. Tippe zum Ansehen.',icon:'icon-192.png',badge:'icon-192.png',tag:'djc-bill',renotify:true,data:{url:'./#mehr/bills'}});
})())});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=(e.notification.data&&e.notification.data.url)||'./';
  e.waitUntil((async()=>{const L=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const c of L){if('focus' in c){await c.focus();if('navigate' in c)try{await c.navigate(url)}catch(x){}return}}if(self.clients.openWindow)await self.clients.openWindow(url)})())});
