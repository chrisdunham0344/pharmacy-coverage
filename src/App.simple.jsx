import { useEffect, useMemo, useState } from 'react';
import { supabase, configOk } from './supabaseClient.js';
import { enablePush, pushPermission, registerServiceWorker, sendPush } from './push.js';
import { ymd, addDays, fmtTime, longDate } from './utils.js';

const LOCATIONS = [];
const STORE_COLORS=['#38bdf8','#a78bfa','#34d399','#f59e0b','#fb7185','#22d3ee','#f97316','#84cc16'];
function storeColor(location, locations){ if(location?.color) return location.color; const i=Math.max(0,locations.findIndex(l=>l.id===location?.id)); return STORE_COLORS[i%STORE_COLORS.length]; }
function storeTint(hex){ const clean=String(hex||'').replace('#',''); return /^[0-9a-fA-F]{6}$/.test(clean)?`#${clean}18`:'#38bdf818'; }

function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (!configOk) {
        throw new Error('APP_CONFIG_MISSING');
      }
      const { error: authError } = await supabase.auth.signInAnonymously();
      if (authError) {
        console.error('Rx Staff anonymous sign-in failed:', authError);
        throw new Error('ANONYMOUS_SIGN_IN_FAILED');
      }
      const { data, error } = await supabase.functions.invoke('simple-login', {
        body: { name: name.trim(), passcode },
      });
      if (error) {
        console.error('Rx Staff simple-login function failed:', error);
        throw new Error('LOGIN_SERVICE_UNAVAILABLE');
      }
      if (!data?.ok) {
        const code = String(data?.error || '');
        if (code === 'LOGIN_FAILED' || code === 'ACCOUNT_DISABLED') throw new Error(code);
        console.error('Rx Staff login returned an unexpected response:', data);
        throw new Error('LOGIN_SERVICE_UNAVAILABLE');
      }
      onLogin(data.person);
    } catch (e) {
      const code = String(e?.message || '');
      if (code.includes('LOGIN_FAILED')) setError('That name or passcode is not correct.');
      else if (code.includes('ACCOUNT_DISABLED')) setError('This account is disabled. Ask the manager for help.');
      else if (code.includes('APP_CONFIG_MISSING')) setError('App connection settings are missing in this Preview deployment. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the Preview environment, then redeploy.');
      else if (code.includes('ANONYMOUS_SIGN_IN_FAILED')) setError('Could not start a login session. In Supabase, enable Anonymous Sign-Ins under Authentication settings, then try again.');
      else setError('The login service could not be reached. Check the Preview deployment and Supabase function logs, then try again.');
    } finally { setBusy(false); }
  }
  return <div className="signin-wrap"><form className="signin" onSubmit={submit}>
    <h1 className="wordmark">Rx <span className="rx">Staff</span></h1>
    <p className="tagline">Your Pharmacy. One Schedule.</p><p>Enter your name and pharmacy passcode.</p>
    <div className="field"><label>Your name</label><input value={name} onChange={e=>setName(e.target.value)} required /></div>
    <div className="field"><label>Passcode</label><input type="password" inputMode="numeric" value={passcode} onChange={e=>setPasscode(e.target.value)} required /></div>
    {error && <div className="error">{error}</div>}
    <button className="btn" disabled={busy}>{busy ? 'Entering…' : 'Enter'}</button>
  </form></div>;
}

function ScheduleForm({ people, locations, onClose, onSaved, me }) {
  const [personId,setPersonId]=useState(people[0]?.id||'');
  const [locationId,setLocationId]=useState('');
  const [date,setDate]=useState(ymd(new Date()));
  const [dayTimes,setDayTimes]=useState({});
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  useEffect(()=>{ if(!locationId && locations[0]) setLocationId(locations[0].id); },[locations,locationId]);
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
    await sendPush({title:'Rx Staff',body:`${p?.name||'Someone'} is scheduled at ${locations.find(x=>x.id===locationId)?.name} on ${longDate(date)} ${fmtTime(start)}–${fmtTime(end)}.`,kind:'schedule'});
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

function EditShiftForm({ shift, people, locations, onClose, onSaved }) {
  const [personId,setPersonId]=useState(shift.person_id);
  const [locationId,setLocationId]=useState(shift.location_id);
  const [date,setDate]=useState(shift.shift_date);
  const [start,setStart]=useState(shift.start_time?.slice(0,5)||'09:00');
  const [end,setEnd]=useState(shift.end_time?.slice(0,5)||'17:00');
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');

  async function save(e){
    e.preventDefault(); setBusy(true); setError('');
    if(!locationId){setError('Choose a store.');setBusy(false);return;}
    if(start>=end){setError('The end time has to be after the start time.');setBusy(false);return;}
    const {data,error:saveError}=await supabase.from('simple_shifts')
      .update({shift_date:date,location_id:locationId,person_id:personId,start_time:start,end_time:end})
      .eq('id',shift.id).select().single();
    if(saveError){
      setError(saveError.message.includes('overlap')||saveError.message.includes('no_overlap')
        ? 'That overlaps another shift for this employee.'
        : 'Could not update that shift.');
      setBusy(false);return;
    }
    const p=people.find(x=>x.id===personId);
    const store=locations.find(x=>x.id===locationId)?.name||'Store';
    await sendPush({
      title:'Rx Staff schedule updated',
      body:`${p?.name||'Someone'} is scheduled at ${store} on ${longDate(date)} ${fmtTime(start)}–${fmtTime(end)}.`,
      kind:'schedule'
    });
    setBusy(false); await onSaved(data); onClose();
  }

  return <div className="overlay"><form className="sheet" onSubmit={save}>
    <div className="sheet-head"><h2>Edit schedule</h2><button type="button" className="icon-btn" onClick={onClose}>×</button></div>
    <div className="field"><label>Employee</label><select value={personId} onChange={e=>setPersonId(e.target.value)}>{people.filter(p=>p.active||p.id===shift.person_id).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    <div className="field"><label>Store</label><select value={locationId} onChange={e=>setLocationId(e.target.value)}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
    <div className="field"><label>Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div>
    <div className="row-2"><div className="field"><label>Start</label><input type="time" value={start} onChange={e=>setStart(e.target.value)} /></div><div className="field"><label>End</label><input type="time" value={end} onChange={e=>setEnd(e.target.value)} /></div></div>
    {error&&<div className="error">{error}</div>}
    <button className="btn" disabled={busy}>{busy?'Saving…':'Save changes'}</button>
  </form></div>;
}

function QuickSchedule({ people, locations, weekStart, shifts, onClose, onSaved, onNotice, me }) {
  const activePeople=people.filter(p=>p.active);
  const [personId,setPersonId]=useState(activePeople[0]?.id||'');
  const [locationId,setLocationId]=useState(locations[0]?.id||'');
  const [dayTimes,setDayTimes]=useState({});
  const [selectedDays,setSelectedDays]=useState([1,2,3,4,5]);
  const [groups,setGroups]=useState([]);
  const [selectedWeekDate,setSelectedWeekDate]=useState(ymd(weekStart));
  const [weekShifts,setWeekShifts]=useState(shifts);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const selectedWeekStart=(()=>{const d=new Date(`${selectedWeekDate}T00:00:00`);d.setDate(d.getDate()-d.getDay());return d;})();
  const weekDays=Array.from({length:7},(_,i)=>addDays(selectedWeekStart,i));
  const personShifts=weekShifts.filter(s=>s.person_id===personId);
  useEffect(()=>{let cancelled=false;async function loadWeek(){const from=ymd(selectedWeekStart),to=ymd(addDays(selectedWeekStart,6));const {data}=await supabase.from('simple_shifts').select('*').gte('shift_date',from).lte('shift_date',to);if(!cancelled)setWeekShifts(data||[]);}loadWeek();return()=>{cancelled=true};},[selectedWeekDate]);
  const existingForDay=dayIndex=>{
    const key=ymd(weekDays[dayIndex]);
    return personShifts.filter(s=>s.shift_date===key);
  };

  function toggleDay(i){
    setError('');
    const assigned=groups.find(g=>g.days.includes(i));
    if(assigned){
      if(assigned.locationId!==locationId){setError('That day is assigned to another store. Switch to that store to change it.');return;}
      setGroups(current=>current.map(g=>g.locationId===locationId?{...g,days:g.days.filter(day=>day!==i)}:g).filter(g=>g.days.length));
      setSelectedDays(current=>current.filter(day=>day!==i));
      return;
    }
    setSelectedDays(current=>current.includes(i)?current.filter(day=>day!==i):[...current,i].sort((a,b)=>a-b));
    setDayTimes(current=>current[i]?current:{...current,[i]:{start:'09:00',end:'17:00'}});
  }
  function changeLocation(nextLocationId){
    if(nextLocationId===locationId) return;
    setGroups(current=>{
      const updated=selectedDays.length
        ? [...current.filter(x=>x.locationId!==locationId),{locationId,days:selectedDays}]
        : current;
      return updated;
    });
    setSelectedDays([]);
    setLocationId(nextLocationId);
  }

  function selectAll(){setError('');setSelectedDays([0,1,2,3,4,5,6].filter(i=>!groups.some(g=>g.days.includes(i))));}
  function weekdays(){setError('');setSelectedDays([1,2,3,4,5].filter(i=>!groups.some(g=>g.days.includes(i))));}
  function clearDays(){setError('');setSelectedDays([]);}

  async function save(){
    setError('');
    if(!personId||!locationId){setError('Choose an employee and store.');return;}
    const allGroups=[...groups,...(selectedDays.length?[{locationId,days:selectedDays}]:[])];
    if(!allGroups.length){setError('Choose at least one day.');return;}
    const dayEntries=allGroups.flatMap(g=>g.days.map(i=>({i,locationId:g.locationId,time:dayTimes[i]||{start:'09:00',end:'17:00'}})));
    if(dayEntries.some(x=>x.time.start>=x.time.end)){setError('Each day needs an end time after its start time.');return;}
    const assignedDays=allGroups.flatMap(g=>g.days);
    if(new Set(assignedDays).size!==assignedDays.length){setError('A day is assigned more than once. Clear or change the duplicate day before saving.');return;}
    setBusy(true);
    const rows=dayEntries.map(({i,locationId,time})=>({shift_date:ymd(weekDays[i]),location_id:locationId,person_id:personId,start_time:time.start,end_time:time.end}));
    const {data,error:saveError}=await supabase.from('simple_shifts').insert(rows).select();
    if(saveError){
      setError(saveError.message.includes('overlap')||saveError.message.includes('no_overlap')
        ? 'One or more selected days overlap an existing shift for this employee.'
        : 'Could not save those shifts.');
      setBusy(false);
      return;
    }
    const person=activePeople.find(p=>p.id===personId);
    const summary=dayEntries.map(x=>`${locations.find(l=>l.id===x.locationId)?.name||'Store'} ${fmtTime(x.time.start)}–${fmtTime(x.time.end)}`).join(', ');
    await sendPush({
      title:'Rx Staff schedule updated',
      body:`${person?.name||'Someone'} was scheduled this week: ${summary}.`,
      kind:'schedule'
    });
    setBusy(false);
    await onSaved(data);
    onNotice?.(`${rows.length} shift${rows.length===1?'':'s'} added for ${person?.name||'the employee'}.`);
    onClose();
  }

  async function copyPreviousWeek(){
    setError('');
    setBusy(true);
    const previousStart=addDays(selectedWeekStart,-7);
    const previousEnd=addDays(selectedWeekStart,-1);
    const {data:previous,error:fetchError}=await supabase.from('simple_shifts')
      .select('shift_date,location_id,person_id,start_time,end_time')
      .gte('shift_date',ymd(previousStart)).lte('shift_date',ymd(previousEnd));
    if(fetchError){setError('Could not load last week.');setBusy(false);return;}
    if(!previous?.length){setError('There are no shifts in the previous week to copy.');setBusy(false);return;}
    const rows=previous.map(s=>({
      shift_date:ymd(addDays(new Date(s.shift_date+'T00:00:00'),7)),
      location_id:s.location_id,
      person_id:s.person_id,
      start_time:s.start_time,
      end_time:s.end_time
    }));
    const {data,error:copyError}=await supabase.from('simple_shifts').insert(rows).select();
    if(copyError){
      setError(copyError.message.includes('overlap')||copyError.message.includes('no_overlap')
        ? 'Some copied shifts overlap shifts already on this week. Nothing was copied.'
        : 'Could not copy last week.');
      setBusy(false);
      return;
    }
    await sendPush({
      title:'Rx Staff schedule updated',
      body:`${rows.length} shift${rows.length===1?'':'s'} copied from last week.`,
      kind:'schedule'
    });
    setBusy(false);
    await onSaved(data);
    onNotice?.(`${rows.length} shift${rows.length===1?'':'s'} copied from last week.`);
    onClose();
  }

  return <div className="overlay"><div className="sheet" style={{maxWidth:760}}>
    <div className="sheet-head">
      <div><h2>Build Week</h2><div style={{fontSize:12,color:'var(--muted)'}}>{weekDays[0].toLocaleDateString(undefined,{month:'short',day:'numeric'})} – {weekDays[6].toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</div></div>
      <button type="button" className="icon-btn" onClick={onClose}>×</button>
    </div>

    <div className="form-card" style={{marginBottom:14}}>
      <div className="field" style={{marginBottom:10}}><label>Schedule week</label><input type="date" value={selectedWeekDate} onChange={e=>setSelectedWeekDate(e.target.value)} /></div>
      <div style={{fontSize:13,color:'var(--muted)',marginBottom:10}}>Choose any date in the week you want to schedule. The week runs Sunday–Saturday.</div>
      <strong>Copy last week</strong>
      <div style={{fontSize:13,color:'var(--muted)',margin:'4px 0 10px'}}>Copies the entire previous week's schedule into this week.</div>
      <button type="button" className="btn ghost" onClick={copyPreviousWeek} disabled={busy}>Copy Previous Week</button>
    </div>

    <div className="field"><label>Employee</label><select value={personId} onChange={e=>setPersonId(e.target.value)}>{activePeople.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    <div className="field"><label>Store</label><select value={locationId} onChange={e=>changeLocation(e.target.value)}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div>

    <div className="field">
      <label>Days for {locations.find(l=>l.id===locationId)?.name||'current store'}</label>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
        <button type="button" className="btn ghost" style={{width:'auto',padding:'7px 10px'}} onClick={weekdays}>Mon–Fri</button>
        <button type="button" className="btn ghost" style={{width:'auto',padding:'7px 10px'}} onClick={selectAll}>Every day</button>
        <button type="button" className="btn ghost" style={{width:'auto',padding:'7px 10px'}} onClick={clearDays}>Clear</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:6}}>
        {weekDays.map((d,i)=>{
          const selected=selectedDays.includes(i);
          const assigned=groups.find(g=>g.days.includes(i));
          const assignedLocation=assigned?locations.find(l=>l.id===assigned.locationId):null;
          const dayLocation=selected?locations.find(l=>l.id===locationId):assignedLocation;
          const color=dayLocation?storeColor(dayLocation,locations):null;
          const has=existingForDay(i).length>0;
          const time=dayTimes[i]||{start:'09:00',end:'17:00'};
          return <div key={ymd(d)} style={{padding:'6px 2px',borderRadius:9,border:dayLocation?`2px solid ${color}`:'1px solid var(--line-strong)',background:dayLocation?storeTint(color):'#fff',textAlign:'center'}}>
            <button type="button" onClick={()=>toggleDay(i)} style={{width:'100%',border:0,background:'transparent',padding:'3px 0',fontWeight:selected||assigned?700:500}}>
              <div style={{fontSize:11,color:'var(--muted)'}}>{d.toLocaleDateString(undefined,{weekday:'short'})}</div><div>{d.getDate()}</div>{has&&<div style={{fontSize:9,color:'var(--muted)',marginTop:2,fontWeight:700}}>SLATED</div>}
            </button>
            {(selected||assigned)&&<div style={{display:'grid',gap:3,marginTop:4}}><input aria-label="Start time" type="time" value={time.start} onChange={e=>setDayTimes(v=>({...v,[i]:{...time,start:e.target.value}}))} style={{width:'100%',minWidth:0,fontSize:10,padding:'3px 0'}}/><input aria-label="End time" type="time" value={time.end} onChange={e=>setDayTimes(v=>({...v,[i]:{...time,end:e.target.value}}))} style={{width:'100%',minWidth:0,fontSize:10,padding:'3px 0'}}/></div>}
          </div>;
        })}
      </div>
    </div>

    {error&&<div className="error">{error}</div>}
    <button type="button" className="btn" onClick={save} disabled={busy}>{busy?'Saving…':`Save ${new Set([...groups.filter(g=>g.locationId!==locationId).flatMap(g=>g.days),...selectedDays]).size} Shift${new Set([...groups.filter(g=>g.locationId!==locationId).flatMap(g=>g.days),...selectedDays]).size===1?'':'s'}`}</button>
  </div></div>;
}

function TimeOffForm({ me, onClose, onSaved }) {
  const [start,setStart]=useState(ymd(new Date())); const [end,setEnd]=useState(ymd(new Date())); const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function save(e){
    e.preventDefault(); setBusy(true); setError('');
    const {data,error}=await supabase.from('simple_time_off').insert({person_id:me.id,start_date:start,end_date:end,note}).select().single();
    if(error){
      console.error('Time-off request failed:',error);
      const msg=String(error.message||'').toUpperCase();
      setError(msg.includes('FLOATER_ONLY')?'This account is not currently marked as an active Floater.':msg.includes('LOGIN_REQUIRED')?'This login session is not connected to an employee.':'Could not submit the request.');
      setBusy(false);return;
    }
    await sendPush({title:'Rx Staff',body:`${me.name} requested time off: ${longDate(start)} through ${longDate(end)}.`,kind:'time_off'});
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
  const [view,setView]=useState('week'); const [anchor,setAnchor]=useState(()=>new Date()); const [modal,setModal]=useState(null); const [notice,setNotice]=useState('');
  const [push,setPush]=useState('default');
  const weekStart=new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()-anchor.getDay());
  const monthStart=new Date(anchor.getFullYear(),anchor.getMonth(),1);
  const monthGridStart=new Date(monthStart.getFullYear(),monthStart.getMonth(),1-monthStart.getDay());
  const days=useMemo(()=>{
    if(view==='day') return [new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate())];
    if(view==='month') return Array.from({length:42},(_,i)=>addDays(monthGridStart,i));
    return Array.from({length:7},(_,i)=>addDays(weekStart,i));
  },[view,anchor]);
  const from=ymd(days[0]), to=ymd(days[days.length-1]);
  async function load(){
    const [{data:p},{data:l},{data:s},{data:t}]=await Promise.all([
      supabase.from('simple_people').select('*').order('name'),
      supabase.from('locations').select('*').eq('active',true).order('sort_order'),
      supabase.from('simple_shifts').select('*').gte('shift_date',from).lte('shift_date',to),
      supabase.from('simple_time_off').select('*').lte('start_date',to).gte('end_date',from)
    ]);
    setPeople(p||[]);setLocations(l||[]);setShifts(s||[]);setTimeOff(t||[]);
  }
  useEffect(()=>{ if(me) load(); },[me,from,to]);
  useEffect(()=>{ if(me){setPush(pushPermission());registerServiceWorker();} },[me]);
  const byDay=useMemo(()=>Object.fromEntries(days.map(d=>[ymd(d),shifts.filter(s=>s.shift_date===ymd(d))])),[shifts,days]);
  function shiftName(id){return people.find(p=>p.id===id)?.name||'Unknown';}
  function shiftLocation(id){return locations.find(l=>l.id===id);}
  function shiftColor(id){return storeColor(shiftLocation(id),locations);}
  function periodTitle(){
    if(view==='day') return anchor.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'});
    if(view==='month') return anchor.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    return days[0].toLocaleDateString(undefined,{month:'short',day:'numeric'})+' – '+days[6].toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  }
  function stepPeriod(direction){
    if(view==='day') return setAnchor(d=>addDays(d,direction));
    if(view==='week') return setAnchor(d=>addDays(d,direction*7));
    return setAnchor(d=>new Date(d.getFullYear(),d.getMonth()+direction,1));
  }
  async function notifications(){const r=await enablePush();setPush(pushPermission());if(r?.ok)setNotice('Notifications are on for this device.');else setNotice(r?.reason==='unsupported'?'Push notifications are not supported by this browser.':r?.reason==='missing-key'?'Notifications are not configured yet.':r?.reason==='denied'?'Notifications are blocked for this site. Open browser site settings and allow notifications, then try again.':r?.reason==='not-logged-in'?'Your login session is missing. Refresh and log in again.':r?.reason==='save-failed'?'Notifications were allowed, but this device could not be registered.':'Could not turn on notifications. Try again.');}
  function openQuickSchedule(){
    const ws=new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()-anchor.getDay());
    setModal('quick');
  }
  if(!me) return <Login onLogin={setMe}/>;
  return <div className="app">
    <div className="topbar"><div><h1 className="wordmark" style={{fontSize:22}}>Rx <span className="rx">Staff</span></h1><div className="sub">{me.name}{me.is_manager?' · Manager':''}</div></div><button className="chip-btn" onClick={notifications}>{push==='granted'?'Notifications on':'Turn on notifications'}</button></div>
    <div className="view-switch">
      <button className={view==='day'?'on':''} onClick={()=>setView('day')}>Day</button>
      <button className={view==='week'?'on':''} onClick={()=>setView('week')}>Week</button>
      <button className={view==='month'?'on':''} onClick={()=>setView('month')}>Month</button>
      <button onClick={()=>setModal('timeoff')}>Request Time Off</button>
    </div>
    <div className="month-bar">
      <button className="icon-btn" onClick={()=>stepPeriod(-1)} aria-label="Previous period">‹</button>
      <div className="month-title">{periodTitle()}</div>
      <div style={{display:'flex',gap:8}}>
        <button className="icon-btn" style={{minWidth:72,paddingLeft:10,paddingRight:10}} onClick={()=>setAnchor(new Date())} aria-label="Today">Today</button>
        <button className="icon-btn" onClick={()=>stepPeriod(1)} aria-label="Next period">›</button>
      </div>
    </div>
    {notice&&<div className="form-card" onClick={()=>setNotice('')}>{notice}</div>}
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>{locations.map(l=><div key={l.id} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:'var(--muted)'}}><span style={{width:10,height:10,borderRadius:3,background:storeColor(l,locations),display:'inline-block'}}/>{l.name}</div>)}</div><div className="toggle-row">{me.is_manager&&<><button className="btn" style={{width:'auto'}} onClick={openQuickSchedule}>Build Week</button><button className="btn ghost" style={{width:'auto'}} onClick={()=>setModal('schedule')}>+ Single Shift</button><button className="btn ghost" style={{width:'auto'}} onClick={()=>setModal('staff')}>Employees</button></>}{!me.is_manager&&<button className="btn ghost" style={{width:'auto'}} onClick={()=>setModal('timeoff')}>Request time off</button>}</div>
    {view==='month' ? (
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:6}}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div key={d} style={{fontSize:12,fontWeight:700,textAlign:'center',padding:'4px 0',color:'var(--muted)'}}>{d}</div>)}
        {days.map(d=>{
          const key=ymd(d); const cellShifts=byDay[key]||[];
          const inMonth=d.getMonth()===anchor.getMonth();
          const todayKey=ymd(new Date());
          const isToday=key===todayKey;
          const isPast=key<todayKey;
          const opacity=isPast?(inMonth?.48:.32):(inMonth?1:.62);
          return <button key={key} onClick={()=>{setAnchor(d);setView('day')}} style={{textAlign:'left',minHeight:105,padding:8,border:isToday?'2px solid var(--accent)':'1px solid var(--border)',borderRadius:10,background:isToday?'var(--accent-soft)':(inMonth?'var(--card)':'var(--bg)'),opacity,cursor:'pointer',boxShadow:isToday?'0 0 0 2px rgba(30,58,138,.08)':'none'}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:5}}>{d.getDate()}{isToday&&<span style={{display:'block',fontSize:8,lineHeight:1.1,marginTop:2,color:'var(--accent)',fontWeight:800,textAlign:'center'}}>TODAY</span>}</div>
            {cellShifts.slice(0,4).map(s=>{const color=shiftColor(s.location_id);const store=shiftLocation(s.location_id)?.name||'Store';return <div key={s.id} style={{fontSize:11,lineHeight:1.35,marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',borderLeft:`4px solid ${color}`,background:storeTint(color),borderRadius:5,padding:'3px 5px'}}><strong>{shiftName(s.person_id)}</strong><br/><span style={{fontWeight:700}}>{store}</span> · {fmtTime(s.start_time)}–{fmtTime(s.end_time)}</div>;})}
            {cellShifts.length>4&&<div style={{fontSize:11,color:'var(--muted)'}}>+{cellShifts.length-4} more</div>}
            {!cellShifts.length&&<div style={{fontSize:11,color:'var(--muted)'}}>No shifts</div>}
          </button>;
        })}
      </div>
    ) : (
      days.map(d=><section className="store-block" key={ymd(d)}>
        <div className="day-head"><div className="big">{d.toLocaleDateString(undefined,{weekday:'long'})}</div><div className="count">{d.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</div></div>
        {(byDay[ymd(d)]||[]).length===0?<div className="empty">No shifts scheduled.</div>:(byDay[ymd(d)]||[]).map(s=><div className="shift-row" key={s.id} style={{borderLeft:`6px solid ${shiftColor(s.location_id)}`,background:storeTint(shiftColor(s.location_id))}}>
          <div className="bar" style={{background:shiftColor(s.location_id)}}/>
          <div style={{flex:1}}><div className="who">{shiftName(s.person_id)}</div><div className="meta"><strong style={{color:shiftColor(s.location_id)}}>{shiftLocation(s.location_id)?.name||'Store'}</strong> · {fmtTime(s.start_time)}–{fmtTime(s.end_time)}</div></div>
          <div style={{display:'flex',gap:6}}>
            <button className="icon-btn" title="Edit shift" aria-label="Edit shift" onClick={()=>setModal({type:'edit',shift:s})}>Edit</button>
            <button className="icon-btn" title="Delete shift" aria-label="Delete shift" onClick={()=>deleteShift(s.id, `${shiftName(s.person_id)} · ${shiftLocation(s.location_id)?.name||'Store'} · ${fmtTime(s.start_time)}–${fmtTime(s.end_time)}`, load, setNotice)}>×</button>
          </div>
        </div>)}
      </section>)
    )}
    {modal==='quick'&&<QuickSchedule me={me} people={people} locations={locations} weekStart={weekStart} shifts={shifts} onClose={()=>setModal(null)} onSaved={load} onNotice={setNotice}/>}
    {modal?.type==='edit'&&<EditShiftForm shift={modal.shift} people={people} locations={locations} onClose={()=>setModal(null)} onSaved={load}/>}
    {modal==='schedule'&&<ScheduleForm me={me} people={people} locations={locations} onClose={()=>setModal(null)} onSaved={load}/>}
    {modal==='timeoff'&&<TimeOffForm me={me} onClose={()=>setModal(null)} onSaved={load}/>}
    {modal==='staff'&&<StaffPanel me={me} people={people} onClose={()=>setModal(null)} onSaved={load}/>}
  </div>;
}

async function deleteShift(id, label, onSaved, onNotice) {
  if(!window.confirm(`Delete this shift?\n\n${label}`)) return;
  const {error}=await supabase.from('simple_shifts').delete().eq('id',id);
  if(error){ onNotice?.('Could not delete that shift.'); return; }
  await sendPush({title:'Rx Staff schedule updated',body:`${label} was removed from the schedule.`,kind:'schedule'});
  await onSaved();
  onNotice?.('Shift deleted.');
}

function StaffPanel({people,onClose,onSaved}){
 const [name,setName]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 async function add(){if(!name.trim())return;setBusy(true);const {error}=await supabase.functions.invoke('manage-people',{body:{action:'add',name:name.trim()}});if(error)setError('Could not add employee.');else{setName('');await onSaved();}setBusy(false);}
 async function remove(id){if(!confirm('Remove this employee?'))return;await supabase.functions.invoke('manage-people',{body:{action:'remove',person_id:id}});await onSaved();}
 async function toggleFloater(id,value){await supabase.functions.invoke('manage-people',{body:{action:'toggle-floater',person_id:id,is_floater:value}});await onSaved();}
 return <div className="overlay"><div className="sheet"><div className="sheet-head"><h2>Employees</h2><button className="icon-btn" onClick={onClose}>×</button></div><div className="row-2"><input placeholder="Employee name" value={name} onChange={e=>setName(e.target.value)}/><button className="btn" onClick={add} disabled={busy}>Add</button></div>{error&&<div className="error">{error}</div>}{people.filter(p=>p.active).map(p=><div className="shift-row" key={p.id}><div style={{flex:1}}><div>{p.name}</div><label style={{fontSize:12,color:'var(--muted)'}}><input type="checkbox" checked={Boolean(p.is_floater)} onChange={e=>toggleFloater(p.id,e.target.checked)} style={{width:'auto',marginRight:6}}/> Floater</label></div><button className="btn danger" style={{width:'auto'}} onClick={()=>remove(p.id)}>Remove</button></div>)}</div></div>
}
