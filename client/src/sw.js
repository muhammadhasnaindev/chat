/*
[PRO] Purpose: Show basic push notifications when app is backgrounded.
Context: Server push payload may vary; fallback text prevents blank notifications.
Edge cases: Missing data, unsupported icons.
Notes: Keep notification minimal to avoid OS spam classification.
*/
self.addEventListener("push", (e) => {
  const data = e.data?.json?.() || {};
  const title = data.title || "New message";
  const body = data.body || "";
  const icon = "/icon.png";

  e.waitUntil(
    self.registration.showNotification(title, { body, icon })
  );
});
