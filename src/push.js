import { supabase } from './supabaseClient.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// iOS only delivers push to sites added to the home screen.
export function isIosSafariNotInstalled() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const installed =
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return isIos && !installed;
}

export function pushPermission() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function registerServiceWorker() {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.error('Service worker registration failed', err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// Asks permission, subscribes the browser, and stores the subscription so the
// edge function can reach this device later.
export async function enablePush(userId) {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'missing-key' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };

  const registration = await registerServiceWorker();
  if (!registration) return { ok: false, reason: 'no-sw' };
  await navigator.serviceWorker.ready;

  let sub = await registration.pushManager.getSubscription();
  if (!sub) {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: 'endpoint' }
  );

  if (error) {
    console.error('Could not save push subscription', error);
    return { ok: false, reason: 'save-failed' };
  }
  return { ok: true };
}

// Called at sign-out, so a shared pharmacy computer stops getting the previous
// person's notifications. Best effort: sign-out continues even if this fails.
export async function disablePush() {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!registration) return;
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return;

    const endpoint = sub.endpoint;
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) console.error('Could not remove push subscription', error);
    await sub.unsubscribe();
  } catch (err) {
    console.error('Push unsubscribe failed', err);
  }
}

// Fires a notification through the edge function. The function checks who is
// allowed to send what, so this is convenience, not security.
export async function sendPush({ userIds, title, body, kind }) {
  try {
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: { user_ids: userIds, title, body, kind },
    });
    if (error) {
      console.error('send-push failed', error);
      return false;
    }
    return Boolean(data && data.ok);
  } catch (err) {
    console.error('send-push threw', err);
    return false;
  }
}
