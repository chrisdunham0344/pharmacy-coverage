import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'https://esm.sh/web-push@3.6.7';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
 try{
  const auth=req.headers.get('Authorization')||''; if(!auth)return json({error:'Not signed in'},401);
  const url=Deno.env.get('SUPABASE_URL')!, admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await caller.auth.getUser(); if(!user)return json({error:'Not signed in'},401);
  const {data:session}=await admin.from('simple_sessions').select('person_id').eq('auth_user_id',user.id).maybeSingle();
  if(!session)return json({error:'Not logged in'},403);
  const input=await req.json().catch(()=>({}));
  const title=String(input.title||'WoRxshift').slice(0,80), body=String(input.body||'').slice(0,240);
  if(!body)return json({error:'Missing body'},400);
  const vapidPublic=Deno.env.get('VAPID_PUBLIC_KEY'), vapidPrivate=Deno.env.get('VAPID_PRIVATE_KEY');
  if(!vapidPublic||!vapidPrivate)return json({error:'Notifications are not configured'},500);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')||'mailto:admin@example.com',vapidPublic,vapidPrivate);
  const {data:subs}=await admin.from('simple_push_subscriptions').select('*').neq('person_id',session.person_id);
  let sent=0; const dead:string[]=[];
  for(const sub of subs||[])try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({title,body,url:'/'}));sent++}catch(e){const code=(e as any)?.statusCode;if(code===404||code===410)dead.push(sub.endpoint);}
  if(dead.length)await admin.from('simple_push_subscriptions').delete().in('endpoint',dead);
  return json({ok:true,sent});
 }catch(e){console.error(e);return json({error:'Something went wrong'},500)}
});