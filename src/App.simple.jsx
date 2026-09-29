import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { enablePush, pushPermission, registerServiceWorker, sendPush } from './push.js';
import { ymd, fromYmd, fmtTime, longDate } from './utils.js';

const LOCATIONS = [];

function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data: auth, error: authError } = await supabase.auth.signInAnonymously();
      if (authError) throw authError;
      const { data, error } = await supabase.functions.invoke('simple-login', {
        body: { name: name.trim(), passcode },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'LOGIN_FAILED');
      onLogin(data.person);
    } catch (e) {
      setError(String(e.message).includes('LOGIN_FAILED') ? 'That name or passcode is not correct.' : 'Could not connect. Try again.');
    } finally { setBusy(false); }
  }
  return <div className="signin-wrap"><form className="signin" onSubmit={submit}>
    <h1 className="wordmark">Wo<span className="rx">Rx</span>shift</h1>
    <p>Enter your name and pharmacy passcode.</p>
    <div className="field"><label>Your name</label><input value={name} onChange={e=>setName(e.target.value)} required /></div>
    <div className="field"><label>Passcode</label><input type="password" inputMode="numeric" value={passcode} onChange={e=>setPasscode(e.target.value)} required /></div>
    {error && <div className="error">{error}</div>}
    <button className="btn" disabled={busy}>{busy ? 'Entering…' : 'Enter'}</button>
  </form></div>;
}

function ScheduleForm({ people, locations, onClose, onSaved }) {
  const [personId,setPersonId]=useState(people[0]?.id||'');
  const [locationId,setLocationId]=useState('');
  const [date,setDate]=useState(ymd(new Date()));
  const [start,setStart]=useState('09:00');
  const [end,setEnd]=useState('17:00');
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function save(e){
    e.preventDefault(); setBusy(true); setError('');
    const {data:{user}}=await supabase.auth.getUser();
    if(!locationId){setError('Choose a store.');setBusy(false);return;}
    const {data,error}=await supabase.from('simple_shifts').insert({
      shift_date:date, location_id:locationId, person_id:personId,
      start_time:start, end_time:end, created_by:personId
    }).select().single();
    if(error){setError(error.message.includes('simple_shift_no_overlap')?'That overlaps an existing shift.':'Could not save that shift.');setBusy(false);return;}
    const p=people.find(x=>x.id===personId);
    await sendPush({title:'WoRxshift',body:`${p?.name||'Someone'} is scheduled at ${locations.find(x=>x.id===locationId)?.name} on ${longDate(date)} ${fmtTime(start)}–${fmtTime(end)}.`,kind:'schedule'});
    setBusy(false); onSaved(data); onClose();
  }
  return <div className="overlay"><form className="sheet" onSubmit={save}>
    <div className="sheet-head"><h2>Add schedule</h2><button type="button" className="icon-btn" onClick={onClose}>×</button></div>
    <div className="field"><label>Employee</label><select value={personId} onChange={e=>setPersonId(e.target.value)}>{people.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    <div className="field"><label>Store</label><select value={locationId} onChange={e=>setLocationId(e.target.value)}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
    <div className="field"><label>Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div>
    <div className="row-2"><div className="field"><label>Start</label><input type="time" value={start} onChange={e=>setStart(e.target.value)} /></div><div className="field"><label>End</label><input type="time" value={end} onChange={e=>setEnd(e.target.value)} /></div></div>
    {error&&<div className="error">{error}</div>}<button className="btn" disabled={busy}>{busy?'Saving…':'Save schedule'}</button>
  </form></div>;
}

function TimeOffForm({ me, onClose, onSaved }) {
  const [start,setStart]=useState(ymd(new Date())); const [end,setEnd]=useState(ymd(new Date())); const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function save(e){
    e.preventDefault(); setBusy(true); setError('');
    const {data:{user}}=await supabase.auth.getUser();
    const {data,error}=await supabase.from('simple_time_off').insert({person_id:me.id,start_date:start,end_date:end,note}).select().single();
    if(error){setError('Could not submit the request.');setBusy(false);return;}
    await sendPush({title:'WoRxshift',body:`${me.name} requested time off: ${longDate(start)} through ${longDate(end)}.`,kind:'time_off'});
    setBusy(false); onSaved(data); onClose();
  }
  return <div className="overlay"><form className="sheet" onSubmit={save}>
    <div className="sheet-head"><h2>Request time off</h2><button type="button" className="icon-btn" onClick={onClose}>×</button></div>
    <p>Requesting for <strong>{me.name}</strong></p>
    <div className="row-2"><div className="field"><label>From</label><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></div><div className="field"><label>Through</label><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></div></div>
    <div className="field"><label>Note (optional)</label><textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={500}/></div>
    {error&&<div className="error">{error}</div>}<button className="btn" disabled={busy}>{busy?'Sending…':'Request time off'}</button>
  </form></div>;
}

export default function App(){
  const [me,setMe]=useState(null); const [people,setPeople]=useState([]); const [locations,setLocations]=useState([]); const [shifts,setShifts]=useState([]); const [timeOff,setTimeOff]=useState([]);
  const [week,setWeek]=useState(()=>new Date()); const [modal,setModal]=useState(null); const [notice,setNotice]=useState('');
  const [push,setPush]=useState('default');
  const start=new Date(week.getFullYear(),week.getMonth(),week.getDate()-week.getDay());
  const days=Array.from({length:7},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i));
  const from=ymd(days[0]), to=ymd(days[6]);
  async function load(){
    const [{data:p},{data:l},{data:s},{data:t}]=await Promise.all([
      supabase.from('simple_people').select('*').eq('active',true).order('name'),
      supabase.from('locations').select('*').eq('active',true).order('sort_order'),
      supabase.from('simple_shifts').select('*').gte('shift_date',from).lte('shift_date',to),
      supabase.from('simple_time_off').select('*').lte('start_date',to).gte('end_date',from)
    ]);
    setPeople(p||[]);setLocations(l||[]);setShifts(s||[]);setTimeOff(t||[]);
  }
  useEffect(()=>{ if(me) load(); },[me,from,to]);
  useEffect(()=>{ if(me){setPush(pushPermission());registerServiceWorker();} },[me]);
  const byDay=useMemo(()=>Object.fromEntries(days.map(d=>[ymd(d),shifts.filter(s=>s.shift_date===ymd(d))])),[shifts]);
  function shiftName(id){return people.find(p=>p.id===id)?.name||'Unknown';}
  async function notifications(){const r=await enablePush();setPush(pushPermission());if(r?.ok)setNotice('Notifications are on for this device.');}
  if(!me) return <Login onLogin={setMe}/>;
  return <div className="app">
    <div className="topbar"><div><h1 className="wordmark" style={{fontSize:22}}>Wo<span className="rx">Rx</span>shift</h1><div className="sub">{me.name}{me.is_manager?' · Manager':''}</div></div><button className="chip-btn" onClick={notifications}>{push==='granted'?'Notifications on':'Turn on notifications'}</button></div>
    <div className="month-bar"><button className="icon-btn" onClick={()=>setWeek(new Date(start.getFullYear(),start.getMonth(),start.getDate()-7))}>‹</button><div className="month-title">{days[0].toLocaleDateString(undefined,{month:'short',day:'numeric'})} – {days[6].toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</div><button className="icon-btn" onClick={()=>setWeek(new Date(start.getFullYear(),start.getMonth(),start.getDate()+7))}>›</button></div>
    {notice&&<div className="form-card" onClick={()=>setNotice('')}>{notice}</div>}
    <div className="toggle-row"><button className="btn" style={{width:'auto'}} onClick={()=>setModal('schedule')}>+ Schedule</button><button className="btn ghost" style={{width:'auto'}} onClick={()=>setModal('timeoff')}>Request Time Off</button>{me.is_manager&&<button className="btn ghost" style={{width:'auto'}} onClick={()=>setModal('staff')}>Employees</button>}</div>
    {days.map(d=><section className="store-block" key={ymd(d)}><div className="day-head"><div className="big">{d.toLocaleDateString(undefined,{weekday:'long'})}</div><div className="count">{d.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</div></div>
      {byDay[ymd(d)].length===0?<div className="empty">No shifts scheduled.</div>:byDay[ymd(d)].map(s=><div className="shift-row" key={s.id}><div className="bar"/><div><div className="who">{shiftName(s.person_id)}</div><div className="meta">{locations.find(l=>l.id===s.location_id)?.name||'Store'} · {fmtTime(s.start_time)}–{fmtTime(s.end_time)}</div></div></div>)}
    </section>)}
    {modal==='schedule'&&<ScheduleForm people={people} locations={locations} onClose={()=>setModal(null)} onSaved={load}/>}
    {modal==='timeoff'&&<TimeOffForm me={me} onClose={()=>setModal(null)} onSaved={load}/>}
    {modal==='staff'&&<StaffPanel me={me} people={people} onClose={()=>setModal(null)} onSaved={load}/>}
  </div>;
}

function StaffPanel({people,onClose,onSaved}){
 const [name,setName]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 async function add(){if(!name.trim())return;setBusy(true);const {error}=await supabase.functions.invoke('manage-people',{body:{action:'add',name:name.trim()}});if(error)setError('Could not add employee.');else{setName('');await onSaved();}setBusy(false);}
 async function remove(id){if(!confirm('Remove this employee?'))return;await supabase.functions.invoke('manage-people',{body:{action:'remove',person_id:id}});await onSaved();}
 return <div className="overlay"><div className="sheet"><div className="sheet-head"><h2>Employees</h2><button className="icon-btn" onClick={onClose}>×</button></div><div className="row-2"><input placeholder="Employee name" value={name} onChange={e=>setName(e.target.value)}/><button className="btn" onClick={add} disabled={busy}>Add</button></div>{error&&<div className="error">{error}</div>}{people.map(p=><div className="shift-row" key={p.id}><div style={{flex:1}}>{p.name}</div><button className="btn danger" style={{width:'auto'}} onClick={()=>remove(p.id)}>Remove</button></div>)}</div></div>
}
