import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
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
  const {data:manager}=await admin.from('simple_people').select('is_manager,active').eq('id',session.person_id).maybeSingle();
  if(!manager?.is_manager||!manager.active)return json({error:'Manager only'},403);
  const input=await req.json().catch(()=>({})); const action=String(input.action||'');
  if(action==='add'){
    const name=String(input.name||'').trim().replace(/\s+/g,' ');
    if(name.length<2||name.length>80)return json({error:'Invalid name'},400);
    const {data,error}=await admin.from('simple_people').insert({name,is_manager:false,active:true}).select().single();
    if(error)return json({error:'Employee already exists'},400);
    return json({ok:true,person:data});
  }
  if(action==='remove'){
    const id=String(input.person_id||'');
    const {error}=await admin.from('simple_people').update({active:false}).eq('id',id).eq('is_manager',false);
    if(error)throw error;
    return json({ok:true});
  }
  return json({error:'Unknown action'},400);
 }catch(e){console.error(e);return json({error:'Something went wrong'},500)}
});