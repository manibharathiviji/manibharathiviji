// Service worker: shows the urgent SOS notification when a push arrives,
// even if the app is closed. Used for SOS alerts only.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || "🆘 Emergency alert";
  const body = data.body || "Tap to open now";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: "sos",
      renotify: true,
      requireInteraction: true,
      vibrate: [300, 120, 300, 120, 300, 120, 700],
      icon: "icon-192.png",
      badge: "icon-192.png",
      data: { url: self.registration.scope },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
