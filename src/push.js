import { supabase } from './supabaseClient.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function isIosSafariNotInstalled() {
  if (typeof window === 'undefined') return false;
  const ua=window.navigator.userAgent;
  const ios=/iPad|iPhone|iPod/.test(ua);
  const installed=window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;
  return ios&&!installed;
}
export function pushPermission(){return pushSupported()?Notification.permission:'unsupported';}
export async function registerServiceWorker(){if(!pushSupported())return null;try{return await navigator.serviceWorker.register('/sw.js')}catch(e){console.error(e);return null}}
function keyBytes(s){const p='='.repeat((4-(s.length%4))%4);const raw=window.atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
export async function enablePush(){
 if(!pushSupported())return{ok:false,reason:'unsupported'};
 if(!VAPID_PUBLIC_KEY)return{ok:false,reason:'missing-key'};
 const permission=await Notification.requestPermission(); if(permission!=='granted')return{ok:false,reason:permission};
 const reg=await registerServiceWorker(); if(!reg)return{ok:false,reason:'no-sw'}; await navigator.serviceWorker.ready;
 let sub=await reg.pushManager.getSubscription();
 if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(VAPID_PUBLIC_KEY)});
 const json=sub.toJSON(); const {data:{user}}=await supabase.auth.getUser();
 const {data:session}=await supabase.from('simple_sessions').select('person_id').eq('auth_user_id',user?.id).maybeSingle();
 if(!user||!session)return{ok:false,reason:'not-logged-in'};
 const {error}=await supabase.from('simple_push_subscriptions').upsert({auth_user_id:user.id,person_id:session.person_id,endpoint:json.endpoint,p256dh:json.keys.p256dh,auth:json.keys.auth},{onConflict:'endpoint'});
 if(error){console.error(error);return{ok:false,reason:'save-failed'}} return{ok:true};
}
export async function disablePush(){
 if(!pushSupported())return; try{const reg=await navigator.serviceWorker.getRegistration('/sw.js');if(!reg)return;const sub=await reg.pushManager.getSubscription();if(!sub)return;await supabase.from('simple_push_subscriptions').delete().eq('endpoint',sub.endpoint);await sub.unsubscribe()}catch(e){console.error(e)}
}
export async function sendPush({title,body,kind}){
 try{const {data,error}=await supabase.functions.invoke('simple-notify',{body:{title,body,kind}});if(error){console.error(error);return false}return Boolean(data?.ok)}catch(e){console.error(e);return false}
}