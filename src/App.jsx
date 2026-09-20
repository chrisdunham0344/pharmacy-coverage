import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configOk } from './supabaseClient.js';
import MonthGrid from './components/MonthGrid.jsx';
import DaySheet from './components/DaySheet.jsx';
import StaffPanel from './components/StaffPanel.jsx';
import TimeOffPanel from './components/TimeOffPanel.jsx';
import { ChevronLeft, ChevronRight, Users, LogOut, CalendarIcon } from './components/Icons.jsx';
import DayView from './components/DayView.jsx';
import WeekView from './components/WeekView.jsx';
import {
  addDays,
  dayTitle,
  fromYmd,
  monthLabel,
  monthRange,
  weekStart,
  weekTitle,
  ymd,
} from './utils.js';
import {
  enablePush,
  isIosSafariNotInstalled,
  pushPermission,
  pushSupported,
  registerServiceWorker,
  sendPush,
} from './push.js';

/* ------------------------------------------------------------------ */
/* Sign in and sign up                                                 */
/* ------------------------------------------------------------------ */

function SignIn() {
  const [mode, setMode] = useState('in'); // 'in' | 'up'
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
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

  async function signUp() {
    if (!fullName.trim()) return setError('Enter your name.');
    if (password.length < 8) return setError('Use at least 8 characters for your password.');

    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    setBusy(false);

    if (err) {
      // The database trigger blocks addresses outside the approved domain.
      if (String(err.message).includes('EMAIL_DOMAIN_NOT_ALLOWED')) {
        setError('Use your work email address. Personal addresses cannot register here.');
      } else if (String(err.message).toLowerCase().includes('already')) {
        setError('An account with that email already exists. Try signing in.');
      } else {
        setError('That did not work. Check your email address and try again.');
      }
      return;
    }

    setDone('Account created. A manager has to approve you before you can see the schedule.');
  }

  if (done) {
    return (
      <div className="signin-wrap">
        <div className="signin">
          <h1>Almost there</h1>
          <p>{done}</p>
          <button className="btn ghost" onClick={() => { setDone(''); setMode('in'); }}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="signin-wrap">
      <div className="signin">
        <h1>Pharmacist coverage</h1>
        <p>
          {mode === 'in'
            ? 'Sign in to see who is working where.'
            : 'Create an account with your work email.'}
        </p>

        {mode === 'up' && (
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
        )}

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
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') mode === 'in' ? signIn() : signUp();
            }}
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={mode === 'in' ? signIn : signUp}
          disabled={busy}
        >
          {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>

        <button
          className="btn ghost"
          style={{ marginTop: 8 }}
          onClick={() => {
            setError('');
            setMode(mode === 'in' ? 'up' : 'in');
          }}
        >
          {mode === 'in' ? 'I need an account' : 'I already have an account'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Waiting for approval                                                */
/* ------------------------------------------------------------------ */

function PendingApproval({ name }) {
  return (
    <div className="signin-wrap">
      <div className="signin">
        <h1>Waiting for approval</h1>
        <p>
          {name ? `${name}, your` : 'Your'} account is set up. A manager has to approve it before
          the schedule appears. You will not need to do anything else — just sign in again later.
        </p>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Setup notice                                                        */
/* ------------------------------------------------------------------ */

function SetupNotice() {
  return (
    <div className="signin-wrap">
      <div className="signin">
        <h1>Not connected yet</h1>
        <p>
          This app cannot reach its database. In Vercel, open Settings then Environment Variables
          and add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then redeploy.
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
  const [meLoaded, setMeLoaded] = useState(false);
  const [locations, setLocations] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [timeOff, setTimeOff] = useState([]);

  const [view, setView] = useState('day');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [locationFilter, setLocationFilter] = useState('all');
  const [showStaff, setShowStaff] = useState(false);
  const [showTimeOff, setShowTimeOff] = useState(false);
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
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setMeLoaded(false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  /* ---------- who am I, stores, people ---------- */

  const loadCore = useCallback(async () => {
    if (!session) return;

    const { data: meRow } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();

    setMe(meRow);
    setMeLoaded(true);

    // An unapproved account can read nothing else, so stop here.
    if (!meRow || !meRow.approved) return;

    const [locRes, profRes] = await Promise.all([
      supabase.from('locations').select('*').eq('active', true).order('sort_order'),
      supabase.from('profiles').select('*').order('full_name'),
    ]);

    if (locRes.error || profRes.error) {
      setLoadError('The schedule could not load. Try signing out and back in.');
      return;
    }
    setLoadError('');
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

  /* ---------- shifts and time off for the visible month ---------- */

  const range = useMemo(() => {
    if (view === 'day') {
      const key = ymd(anchor);
      return { from: key, to: key };
    }
    if (view === 'week') {
      const start = weekStart(anchor);
      return { from: ymd(start), to: ymd(addDays(start, 6)) };
    }
    return monthRange(anchor);
  }, [view, anchor]);

  const loadShifts = useCallback(async () => {
    if (!session || !me || !me.approved) return;

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
  }, [session, me, range.from, range.to]);

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

  const visibleShifts = useMemo(
    () =>
      shifts.filter((s) => {
        if (mineOnly && s.pharmacist_id !== session?.user?.id) return false;
        if (locationFilter !== 'all' && s.location_id !== locationFilter) return false;
        return true;
      }),
    [shifts, mineOnly, locationFilter, session]
  );

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

  // Only floating pharmacists can be put on the schedule.
  const floaters = useMemo(
    () => profiles.filter((p) => p.active && p.approved && p.is_floater),
    [profiles]
  );

  const pendingCount = useMemo(
    () => profiles.filter((p) => !p.approved).length,
    [profiles]
  );

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

  async function publishMonth() {
    const ok = await sendPush({
      userIds: null,
      title: 'Schedule posted',
      body: `The ${monthLabel(anchor)} schedule is up. Open the app to see your shifts.`,
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
      .update({
        full_name: p.full_name,
        initials: p.initials,
        role: p.role,
        active: p.active,
        approved: p.approved,
      })
      .eq('id', p.id);
    if (error) return false;
    await loadCore();
    return true;
  }

  function step(delta) {
    setAnchor((d) => {
      if (view === 'day') return addDays(d, delta);
      if (view === 'week') return addDays(d, delta * 7);
      return new Date(d.getFullYear(), d.getMonth() + delta, 1);
    });
  }

  const periodTitle =
    view === 'day' ? dayTitle(anchor) : view === 'week' ? weekTitle(anchor) : monthLabel(anchor);

  /* ---------- render ---------- */

  if (!configOk) return <SetupNotice />;
  if (!ready) return <div className="app"><p className="empty">Loading…</p></div>;
  if (!session) return <SignIn />;
  if (!meLoaded) return <div className="app"><p className="empty">Loading…</p></div>;
  if (!me || !me.approved) return <PendingApproval name={me ? me.full_name : ''} />;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Pharmacist coverage</h1>
          <div className="sub">{me.full_name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={() => setShowTimeOff(true)} aria-label="Time off">
            <CalendarIcon />
          </button>
          {isManager && (
            <button
              className="icon-btn"
              onClick={() => setShowStaff(true)}
              aria-label={pendingCount > 0 ? `Pharmacists, ${pendingCount} waiting` : 'Pharmacists'}
              style={pendingCount > 0 ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            >
              <Users />
            </button>
          )}
          <button className="icon-btn" onClick={() => supabase.auth.signOut()} aria-label="Sign out">
            <LogOut />
          </button>
        </div>
      </header>

      {isManager && floaters.length === 0 && (
        <div className="form-card" style={{ marginBottom: 10, fontSize: 13 }}>
          <div style={{ marginBottom: 8 }}>
            Nobody is marked as a floating pharmacist yet, so there is no one to schedule.
          </div>
          <button className="btn ghost" onClick={() => setShowStaff(true)}>
            Mark who floats
          </button>
        </div>
      )}

      {isManager && pendingCount > 0 && (
        <div className="form-card" style={{ marginBottom: 10, fontSize: 13 }}>
          <div style={{ marginBottom: 8 }}>
            {pendingCount} {pendingCount === 1 ? 'person is' : 'people are'} waiting to be approved.
          </div>
          <button className="btn ghost" onClick={() => setShowStaff(true)}>
            Review them
          </button>
        </div>
      )}

      <div className="view-switch">
        <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Day</button>
        <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Week</button>
        <button className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>Month</button>
      </div>

      <div className="month-bar">
        <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">
          <ChevronLeft />
        </button>
        <div className="month-title">{periodTitle}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={() => setAnchor(new Date())} aria-label="Today">
            <CalendarIcon />
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next">
            <ChevronRight />
          </button>
        </div>
      </div>

      <div className="toggle-row">
        <button className={`chip-btn${mineOnly ? ' on' : ''}`} onClick={() => setMineOnly((v) => !v)}>
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
          Post {monthLabel(anchor)} and notify everyone
        </button>
      )}

      {view === 'day' && (
        <DayView
          shifts={shiftsByDate[ymd(anchor)] || []}
          locationsById={locationsById}
          profilesById={profilesById}
          isManager={isManager}
          onOpenDay={() => setSelectedDate(ymd(anchor))}
        />
      )}

      {view === 'week' && (
        <WeekView
          anchor={anchor}
          shiftsByDate={shiftsByDate}
          locationsById={locationsById}
          profilesById={profilesById}
          onSelectDate={setSelectedDate}
        />
      )}

      {view === 'month' && (
        <MonthGrid
          viewDate={anchor}
          shiftsByDate={shiftsByDate}
          locationsById={locationsById}
          profilesById={profilesById}
          onSelectDate={setSelectedDate}
        />
      )}

      {selectedDate && (
        <DaySheet
          dateKey={selectedDate}
          shifts={shiftsByDate[selectedDate] || []}
          locations={locations}
          profiles={floaters}
          isManager={isManager}
          offUserIds={offUserIds}
          saving={saving}
          onClose={() => setSelectedDate(null)}
          onSave={saveShift}
          onDelete={deleteShift}
        />
      )}

      {showTimeOff && (
        <TimeOffPanel
          me={me}
          profilesById={profilesById}
          isManager={isManager}
          onClose={() => setShowTimeOff(false)}
          onChanged={loadShifts}
        />
      )}

      {showStaff && (
        <StaffPanel profiles={profiles} onClose={() => setShowStaff(false)} onSave={saveProfile} />
      )}
    </div>
  );
}
