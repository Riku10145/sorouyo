// #32 予定通知用の最小Service Worker。
// AndroidのChromeは `new Notification()` を受け付けず、ServiceWorkerRegistration.showNotification が必要なため登録する。
// 通知の発射判断はページ側（frontend/src/feature/settings/notifications.ts）が行い、ここでは表示の受け皿だけを用意する。
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => 'focus' in client);
    if (existing) return existing.focus();
    return self.clients.openWindow('/');
  }));
});
