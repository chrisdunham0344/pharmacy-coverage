import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
 try{
  const auth=req.headers.get('Authorization')||''; if(!auth)return json({error:'Not signed in'},401);
  const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(url,key);
  const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await caller.auth.getUser(); if(!user)return json({error:'Not signed in'},401);
  const input=await req.json().catch(()=>({})); const name=String(input.name||'').trim().replace(/\s+/g,' ');
  const pass=String(input.passcode||'');
  if(name.length<2||name.length>80)return json({error:'LOGIN_FAILED'},400);
  const employee=Deno.env.get('WORXSHIFT_EMPLOYEE_PASSCODE');
  const manager=Deno.env.get('WORXSHIFT_MANAGER_PASSCODE');
  let isManager=false;
  if(pass===manager)isManager=true; else if(pass!==employee)return json({error:'LOGIN_FAILED'},401);
  const {data:existingManager}=await admin.from('simple_people').select('id,name').eq('is_manager',true).eq('active',true).maybeSingle();
  if(isManager && existingManager && existingManager.name.toLowerCase()!==name.toLowerCase())return json({error:'LOGIN_FAILED'},401);
  let {data:person}=await admin.from('simple_people').select('*').ilike('name',name).maybeSingle();
  if(person && !person.active)return json({error:'ACCOUNT_DISABLED'},403);
  if(!person){
    const {data:newPerson,error}=await admin.from('simple_people').insert({name,is_manager:isManager}).select().single();
    if(error)throw error; person=newPerson;
  } else if(isManager && !person.is_manager){
    const {data:promoted,error}=await admin.from('simple_people').update({is_manager:true}).eq('id',person.id).select().single();
    if(error)throw error; person=promoted;
  }
  const {error:sessionError}=await admin.from('simple_sessions').upsert({auth_user_id:user.id,person_id:person.id});
  if(sessionError)throw sessionError;
  return json({ok:true,person:{id:person.id,name:person.name,is_manager:person.is_manager}});
 }catch(e){console.error(e);return json({error:'Something went wrong'},500)}
});