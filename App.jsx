import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configOk } from './supabaseClient.js';
import MonthGrid from './components/MonthGrid.jsx';
import DaySheet from './components/DaySheet.jsx';
import StaffPanel from './components/StaffPanel.jsx';
import TimeOffPanel from './components/TimeOffPanel.jsx';
import { ChevronLeft, ChevronRight, Users, LogOut, CalendarIcon } from './components/Icons.jsx';
import { monthLabel, monthRange } from './utils.js';
import {
  enablePush,
  isIosSafariNotInstalled,
  pushPermission,
  pushSupported,
  registerServiceWorker,
  sendPush,
} from './push.js';

/* ------------------------------------------------------------------ */
/* Sign in                                                             */
/* ------------------------------------------------------------------ */

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (err) setError('That email and password did not match. Check them and try again.');
  }

  return (
    <div className="signin-wrap">
      <div className="signin">
        <h1>Pharmacist coverage</h1>
        <p>Sign in to see who is working where.</p>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') signIn();
            }}
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button className="btn" style={{ marginTop: 12 }} onClick={signIn} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Setup notice — shown when the environment variables are missing      */
/* ------------------------------------------------------------------ */

function SetupNotice() {
  return (
    <div className="signin-wrap">
      <div className="signin">
        <h1>Not connected yet</h1>
        <p>
          This app cannot reach its database. In Vercel, open Settings then
          Environment Variables and add VITE_SUPABASE_URL and
          VITE_SUPABASE_ANON_KEY, then redeploy.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  const [me, setMe] = useState(null);
  const [locations, setLocations] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [shifts, setShifts] = useState([]);

  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [locationFilter, setLocationFilter] = useState('all');
  const [showStaff, setShowStaff] = useState(false);
  const [showTimeOff, setShowTimeOff] = useState(false);
  const [timeOff, setTimeOff] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pushState, setPushState] = useState('default');
  const [notice, setNotice] = useState('');

  /* ---------- session ---------- */

  useEffect(() => {
    if (!configOk) {
      setReady(true);
      return;
    }
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  /* ---------- who am I, stores, people ---------- */

  const loadCore = useCallback(async () => {
    if (!session) return;
    const [meRes, locRes, profRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('locations').select('*').eq('active', true).order('sort_order'),
      supabase.from('profiles').select('*').order('full_name'),
    ]);
    if (meRes.error || locRes.error || profRes.error) {
      setLoadError('The schedule could not load. Pull down to refresh, or try signing out and back in.');
      return;
    }
    setLoadError('');
    setMe(meRes.data);
    setLocations(locRes.data || []);
    setProfiles(profRes.data || []);
  }, [session]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  /* ---------- notifications ---------- */

  useEffect(() => {
    if (!session) return;
    setPushState(pushPermission());
    registerServiceWorker();
  }, [session]);

  async function turnOnNotifications() {
    const result = await enablePush(session.user.id);
    setPushState(pushPermission());
    if (result.ok) {
      setNotice('Notifications are on for this device.');
    } else if (result.reason === 'denied') {
      setNotice('Your browser is blocking notifications. Turn them back on in site settings.');
    } else if (result.reason === 'unsupported') {
      setNotice('This browser cannot receive notifications.');
    } else {
      setNotice('Notifications could not be turned on. Try again.');
    }
  }

  /* ---------- shifts for the visible month ---------- */

  const range = useMemo(() => monthRange(viewDate), [viewDate]);

  const loadShifts = useCallback(async () => {
    if (!session) return;
    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .gte('shift_date', range.from)
      .lte('shift_date', range.to);
    if (error) {
      setLoadError('The schedule could not load. Check your connection and try again.');
      return;
    }
    setLoadError('');
    setShifts(data || []);

    const { data: off } = await supabase
      .from('time_off')
      .select('*')
      .eq('status', 'approved')
      .lte('start_date', range.to)
      .gte('end_date', range.from);
    setTimeOff(off || []);
  }, [session, range.from, range.to]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  /* ---------- derived ---------- */

  const isManager = me?.role === 'manager';

  const locationsById = useMemo(
    () => Object.fromEntries(locations.map((l) => [l.id, l])),
    [locations]
  );

  const profilesById = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p])),
    [profiles]
  );

  const visibleShifts = useMemo(() => {
    return shifts.filter((s) => {
      if (mineOnly && s.pharmacist_id !== session?.user?.id) return false;
      if (locationFilter !== 'all' && s.location_id !== locationFilter) return false;
      return true;
    });
  }, [shifts, mineOnly, locationFilter, session]);

  const shiftsByDate = useMemo(() => {
    const map = {};
    for (const s of visibleShifts) {
      (map[s.shift_date] ||= []).push(s);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const oa = locationsById[a.location_id]?.sort_order ?? 99;
        const ob = locationsById[b.location_id]?.sort_order ?? 99;
        if (oa !== ob) return oa - ob;
        return String(a.start_time).localeCompare(String(b.start_time));
      });
    }
    return map;
  }, [visibleShifts, locationsById]);

  const activeProfiles = useMemo(() => profiles.filter((p) => p.active), [profiles]);

  // Everyone with approved time off covering the day that is open in the sheet.
  const offUserIds = useMemo(() => {
    if (!selectedDate) return new Set();
    return new Set(
      timeOff
        .filter((t) => t.start_date <= selectedDate && t.end_date >= selectedDate)
        .map((t) => t.user_id)
    );
  }, [timeOff, selectedDate]);

  /* ---------- actions ---------- */

  async function saveShift(shift) {
    setSaving(true);
    const payload = {
      shift_date: shift.shift_date,
      location_id: shift.location_id,
      pharmacist_id: shift.pharmacist_id,
      start_time: shift.start_time,
      end_time: shift.end_time,
      notes: shift.notes,
      created_by: session.user.id,
    };
    const query = shift.id
      ? supabase.from('shifts').update(payload).eq('id', shift.id)
      : supabase.from('shifts').insert(payload);
    const { error } = await query;
    setSaving(false);
    if (error) return false;
    await loadShifts();

    // Tell the pharmacist their own shift changed.
    if (shift.pharmacist_id) {
      const loc = locationsById[shift.location_id];
      sendPush({
        userIds: [shift.pharmacist_id],
        title: shift.id ? 'Your shift changed' : 'New shift assigned',
        body: `${loc ? loc.name : 'A store'} on ${shift.shift_date}, ${shift.start_time}–${shift.end_time}`,
      });
    }
    return true;
  }

  // Manager announces that the month is set.
  async function publishMonth() {
    const ok = await sendPush({
      userIds: null,
      title: 'Schedule posted',
      body: `The ${monthLabel(viewDate)} schedule is up. Open the app to see your shifts.`,
    });
    setNotice(ok ? 'Everyone with notifications on has been told.' : 'The notification could not be sent.');
  }

  async function deleteShift(id) {
    const { error } = await supabase.from('shifts').delete().eq('id', id);
    if (!error) await loadShifts();
  }

  async function saveProfile(p) {
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: p.full_name, initials: p.initials, role: p.role, active: p.active })
      .eq('id', p.id);
    if (error) return false;
    await loadCore();
    return true;
  }

  function shiftMonth(delta) {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  /* ---------- render ---------- */

  if (!configOk) return <SetupNotice />;
  if (!ready) {
    return <div className="app"><p className="empty">Loading…</p></div>;
  }
  if (!session) return <SignIn />;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Pharmacist coverage</h1>
          <div className="sub">{me ? me.full_name : 'Loading…'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="icon-btn"
            onClick={() => setShowTimeOff(true)}
            aria-label="Time off"
          >
            <CalendarIcon />
          </button>
          {isManager && (
            <button className="icon-btn" onClick={() => setShowStaff(true)} aria-label="Pharmacists">
              <Users />
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => supabase.auth.signOut()}
            aria-label="Sign out"
          >
            <LogOut />
          </button>
        </div>
      </header>

      <div className="month-bar">
        <button className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
          <ChevronLeft />
        </button>
        <div className="month-title">{monthLabel(viewDate)}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={() => setViewDate(new Date())} aria-label="This month">
            <CalendarIcon />
          </button>
          <button className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight />
          </button>
        </div>
      </div>

      <div className="toggle-row">
        <button
          className={`chip-btn${mineOnly ? ' on' : ''}`}
          onClick={() => setMineOnly((v) => !v)}
        >
          My shifts
        </button>
        <button
          className={`chip-btn${locationFilter === 'all' ? ' on' : ''}`}
          onClick={() => setLocationFilter('all')}
        >
          All stores
        </button>
        {locations.map((l) => (
          <button
            key={l.id}
            className={`chip-btn${locationFilter === l.id ? ' on' : ''}`}
            onClick={() => setLocationFilter(l.id)}
          >
            {l.abbrev}
          </button>
        ))}
      </div>

      <div className="legend">
        {locations.map((l) => (
          <span key={l.id}>
            <span className="dot" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
      </div>

      {loadError && <div className="error" style={{ marginBottom: 10 }}>{loadError}</div>}

      {notice && (
        <div
          className="form-card"
          style={{ marginBottom: 10, fontSize: 13, display: 'flex', gap: 10, alignItems: 'center' }}
        >
          <span style={{ flex: 1 }}>{notice}</span>
          <button className="chip-btn" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      {pushSupported() && pushState === 'default' && (
        <div className="form-card" style={{ marginBottom: 10, fontSize: 13 }}>
          <div style={{ marginBottom: 8 }}>
            Get a notification when your shifts change.
            {isIosSafariNotInstalled() &&
              ' On iPhone, first tap Share and Add to Home Screen, then open it from there.'}
          </div>
          <button className="btn ghost" onClick={turnOnNotifications}>
            Turn on notifications
          </button>
        </div>
      )}

      {isManager && (
        <button className="btn ghost" style={{ marginBottom: 10 }} onClick={publishMonth}>
          Post {monthLabel(viewDate)} and notify everyone
        </button>
      )}

      <MonthGrid
        viewDate={viewDate}
        shiftsByDate={shiftsByDate}
        locationsById={locationsById}
        profilesById={profilesById}
        onSelectDate={setSelectedDate}
        showGaps={!mineOnly && locationFilter === 'all'}
        locationCount={locations.length}
      />

      {selectedDate && (
        <DaySheet
          dateKey={selectedDate}
          shifts={shiftsByDate[selectedDate] || []}
          locations={locations}
          profiles={activeProfiles}
          isManager={isManager}
          offUserIds={offUserIds}
          saving={saving}
          onClose={() => setSelectedDate(null)}
          onSave={saveShift}
          onDelete={deleteShift}
        />
      )}

      {showTimeOff && me && (
        <TimeOffPanel
          me={me}
          profilesById={profilesById}
          isManager={isManager}
          onClose={() => setShowTimeOff(false)}
          onChanged={loadShifts}
        />
      )}

      {showStaff && (
        <StaffPanel
          profiles={profiles}
          onClose={() => setShowStaff(false)}
          onSave={saveProfile}
        />
      )}
    </div>
  );
}
