// Service Worker — VetFlow Mobile
const CACHE = 'vetflow-mobile-v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => clients.claim());

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'VetFlow', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: data,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
