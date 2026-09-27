import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configOk } from './supabaseClient.js';
import MonthGrid from './components/MonthGrid.jsx';
import DaySheet from './components/DaySheet.jsx';
import StaffPanel from './components/StaffPanel.jsx';
import TimeOffPanel from './components/TimeOffPanel.jsx';
import { ChevronLeft, ChevronRight, Users, LogOut, CalendarIcon } from './components/Icons.jsx';
import DayView from './components/DayView.jsx';
import WeekView from './components/WeekView.jsx';
import BulkSchedule from './components/BulkSchedule.jsx';
import {
  addDays,
  dayTitle,
  friendlyError,
  fromYmd,
  monthLabel,
  monthRange,
  weekStart,
  shiftLine,
  weekTitle,
  ymd,
} from './utils.js';
import {
  disablePush,
  enablePush,
  isIosSafariNotInstalled,
  pushPermission,
  pushSupported,
  registerServiceWorker,
  sendPush,
} from './push.js';

// Stops this device receiving the signed-out person's notifications, then
// signs out. Used everywhere a sign-out button appears.
async function signOutEverywhere() {
  await disablePush();
  await supabase.auth.signOut();
}

/* ------------------------------------------------------------------ */
/* Sign in and sign up                                                 */
/* ------------------------------------------------------------------ */

function SignIn() {
  const [mode, setMode] = useState('in'); // 'in' | 'up' | 'forgot'
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

  async function sendReset() {
    if (!email.trim()) return setError('Enter your email address first.');
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });
    setBusy(false);
    if (err) {
      setError('That did not send. Check the address and try again.');
      return;
    }
    // Deliberately vague: never reveal whether an address has an account.
    setDone('If that address has an account, a reset link is on its way. Check your email.');
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
        <h1 className="wordmark">Wo<span className="rx">Rx</span>shift</h1>
        <p>
          {mode === 'in'
            ? 'Sign in to see who is working where.'
            : mode === 'up'
              ? 'Create an account with your work email.'
              : 'We will email you a link to set a new password.'}
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

        {mode !== 'forgot' && (
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
        )}

        {error && <div className="error">{error}</div>}

        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={mode === 'in' ? signIn : mode === 'up' ? signUp : sendReset}
          disabled={busy}
        >
          {busy
            ? 'Working…'
            : mode === 'in'
              ? 'Sign in'
              : mode === 'up'
                ? 'Create account'
                : 'Email me a reset link'}
        </button>

        <button
          className="btn ghost"
          style={{ marginTop: 8 }}
          onClick={() => {
            setError('');
            setMode(mode === 'up' ? 'in' : mode === 'in' ? 'up' : 'in');
          }}
        >
          {mode === 'up' ? 'I already have an account' : mode === 'in' ? 'I need an account' : 'Back to sign in'}
        </button>

        {mode === 'in' && (
          <button
            className="chip-btn"
            style={{ marginTop: 12, width: '100%', border: 'none', background: 'transparent' }}
            onClick={() => {
              setError('');
              setMode('forgot');
            }}
          >
            Forgot your password?
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Set a new password (arrived from the emailed reset link)            */
/* ------------------------------------------------------------------ */

function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');

    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (err) {
      setError('That did not save. The link may have expired — ask for a new one.');
      return;
    }
    onDone();
  }

  return (
    <div className="signin-wrap">
      <div className="signin">
        <h1>Set a new password</h1>
        <p>Pick something you will remember. At least 8 characters.</p>

        <div className="field">
          <label htmlFor="np">New password</label>
          <input
            id="np"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="np2">Type it again</label>
          <input
            id="np2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button className="btn" style={{ marginTop: 12 }} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
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
        <button className="btn ghost" onClick={signOutEverywhere}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Could not load the account (network) and deactivated accounts       */
/* ------------------------------------------------------------------ */

function LoadFailed({ onRetry }) {
  return (
    <div className="signin-wrap">
      <div className="signin">
        <h1>Could not connect</h1>
        <p>WoRxshift could not reach the server. Check your internet connection and try again.</p>
        <button className="btn" onClick={onRetry}>Try again</button>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={signOutEverywhere}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function Deactivated() {
  return (
    <div className="signin-wrap">
      <div className="signin">
        <h1>Account turned off</h1>
        <p>A manager has turned off this account. If that is a mistake, ask your manager to turn it back on.</p>
        <button className="btn ghost" onClick={signOutEverywhere}>Sign out</button>
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
  const [recovery, setRecovery] = useState(false);

  const [me, setMe] = useState(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [coreFailed, setCoreFailed] = useState(false);
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
  const [showBulk, setShowBulk] = useState(false);
  const [bulkShifts, setBulkShifts] = useState([]);
  const [bulkTimeOff, setBulkTimeOff] = useState([]);
  const [bulkKeys, setBulkKeys] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
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
    // A reset link lands here with a recovery token in the URL. Supabase signs
    // the person in with it, so we must catch that and show the password screen
    // instead of the calendar.
    if (window.location.hash.includes('type=recovery')) setRecovery(true);

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
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

    const { data: meRow, error: meErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();

    if (meErr) {
      setCoreFailed(true);
      setMeLoaded(true);
      return;
    }

    setCoreFailed(false);
    setMe(meRow);
    setMeLoaded(true);

    // An unapproved or turned-off account can read nothing else, so stop here.
    if (!meRow || !meRow.approved || !meRow.active) return;

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

  /* ---------- Escape closes whatever sheet is open ---------- */

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      setSelectedDate(null);
      setShowBulk(false);
      setShowStaff(false);
      setShowTimeOff(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    if (view === 'week' || view === 'biweek') {
      const start = weekStart(anchor);
      return { from: ymd(start), to: ymd(addDays(start, view === 'biweek' ? 13 : 6)) };
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

    const { data: off, error: offErr } = await supabase
      .from('time_off')
      .select('id, user_id, start_date, end_date, status')
      .eq('status', 'approved')
      .lte('start_date', range.to)
      .gte('end_date', range.from);
    if (offErr) {
      setLoadError('Time off could not load, so conflict warnings may be missing. Try again shortly.');
      return;
    }
    setTimeOff(off || []);
  }, [session, me, range.from, range.to]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  /* ---------- derived ---------- */

  const isManager = me?.role === 'manager';
  const isFloater = Boolean(me?.is_floater);

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
    };

    // .select() so an edit to a shift someone else already deleted is caught
    // instead of quietly "succeeding" with zero rows changed.
    const query = shift.id
      ? supabase.from('shifts').update(payload).eq('id', shift.id).select('id')
      : supabase.from('shifts').insert(payload).select('id');

    const { data, error } = await query;
    setSaving(false);
    if (error) return friendlyError(error);
    if (!data || data.length === 0) {
      await loadShifts();
      return 'That shift was removed by someone else. The day has been refreshed.';
    }
    await loadShifts();

    if (shift.pharmacist_id) {
      const loc = locationsById[shift.location_id];
      sendPush({
        userIds: [shift.pharmacist_id],
        title: shift.id ? 'Your shift changed' : 'New shift assigned',
        body: `${loc ? loc.name : 'A store'} · ${shiftLine(shift.shift_date, shift.start_time, shift.end_time)}`,
      });
    }
    return true;
  }

  // The one way in. Always a two week block starting from the current week,
  // and it loads that block's shifts itself so the view you happen to be in
  // does not matter.
  async function openBuilder() {
    setBulkBusy(true);
    const start = weekStart(anchor);
    const keys = [];
    for (let i = 0; i < 14; i++) keys.push(ymd(addDays(start, i)));

    const [shiftRes, offRes] = await Promise.all([
      supabase.from('shifts').select('*').gte('shift_date', keys[0]).lte('shift_date', keys[13]),
      supabase
        .from('time_off')
        .select('id, user_id, start_date, end_date, status')
        .eq('status', 'approved')
        .lte('start_date', keys[13])
        .gte('end_date', keys[0]),
    ]);

    setBulkBusy(false);

    if (shiftRes.error || offRes.error) {
      setNotice('The schedule could not load. Check your connection and try again.');
      return;
    }

    setBulkKeys(keys);
    setBulkShifts(shiftRes.data || []);
    setBulkTimeOff(offRes.data || []);
    setShowBulk(true);
  }

  // One database call for the whole fortnight. The database applies every day
  // or none of them, so a dropped connection cannot leave half a schedule.
  async function saveBulk({ floaterId, days }) {
    if (!days || days.length === 0) {
      setNotice('No changes to save.');
      return true;
    }

    const { data: changed, error } = await supabase.rpc('save_schedule_period', {
      p_pharmacist: floaterId,
      p_days: days,
    });

    if (error) return friendlyError(error, 'That did not save. Nothing was changed. Try again.');

    await loadShifts();

    if (changed > 0) {
      sendPush({
        userIds: [floaterId],
        title: 'Your schedule was updated',
        body: `Your shifts for ${weekTitle(fromYmd(days[0].date), 14)} have changed. Open the app to see them.`,
      });
      setNotice('Schedule saved.');
    } else {
      setNotice('No changes to save.');
    }
    return true;
  }

  // Tells everyone — including the seven store pharmacists, who are not on the
  // schedule themselves but need to know when a floater is coming.
  async function announceSchedule() {
    const ok = await sendPush({
      userIds: null,
      title: 'Schedule posted',
      body: `The schedule for ${weekTitle(anchor, 14)} is up. Open the app to see it.`,
    });
    setNotice(
      ok ? 'Everyone with notifications on has been told.' : 'The notification could not be sent.'
    );
  }

  async function deleteShift(id) {
    const { error } = await supabase.from('shifts').delete().eq('id', id);
    if (error) return friendlyError(error, 'That did not delete. Try again.');
    await loadShifts();
    return true;
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
        is_floater: Boolean(p.is_floater),
      })
      .eq('id', p.id);
    if (error) return friendlyError(error);
    await loadCore();
    return true;
  }

  function step(delta) {
    setAnchor((d) => {
      if (view === 'day') return addDays(d, delta);
      if (view === 'week') return addDays(d, delta * 7);
      if (view === 'biweek') return addDays(d, delta * 14);
      return new Date(d.getFullYear(), d.getMonth() + delta, 1);
    });
  }

  const periodTitle =
    view === 'day'
      ? dayTitle(anchor)
      : view === 'week'
        ? weekTitle(anchor)
        : view === 'biweek'
          ? weekTitle(anchor, 14)
          : monthLabel(anchor);

  /* ---------- render ---------- */

  if (!configOk) return <SetupNotice />;
  if (!ready) return <div className="app"><p className="empty">Loading…</p></div>;

  if (recovery) {
    return (
      <ResetPassword
        onDone={() => {
          window.history.replaceState(null, '', window.location.pathname);
          setRecovery(false);
          setNotice('Your password was changed.');
        }}
      />
    );
  }

  if (!session) return <SignIn />;
  if (!meLoaded) return <div className="app"><p className="empty">Loading…</p></div>;
  if (coreFailed) return <LoadFailed onRetry={loadCore} />;
  if (!me || !me.approved) return <PendingApproval name={me ? me.full_name : ''} />;
  if (!me.active) return <Deactivated />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-line">
          <span className="mark">Rx</span>
          <div>
            <h1>Wo<span style={{ color: 'var(--brand-green)' }}>Rx</span>shift</h1>
            <div className="sub">{me.full_name}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
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
          <button className="icon-btn" onClick={signOutEverywhere} aria-label="Sign out">
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
        <button className={view === 'biweek' ? 'on' : ''} onClick={() => setView('biweek')}>2 Wks</button>
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
        {isFloater && (
          <button className={`chip-btn${mineOnly ? ' on' : ''}`} onClick={() => setMineOnly((v) => !v)}>
            My shifts
          </button>
        )}
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
        <button className="btn" style={{ marginBottom: 10 }} onClick={openBuilder} disabled={bulkBusy}>
          {bulkBusy ? 'Opening…' : 'Make schedule'}
        </button>
      )}

      {isManager && (
        <button className="btn ghost" style={{ marginBottom: 10 }} onClick={announceSchedule}>
          Tell everyone the schedule is posted
        </button>
      )}

      {isFloater && (
        <button className="btn ghost" style={{ marginBottom: 10 }} onClick={() => setShowTimeOff(true)}>
          Request time off
        </button>
      )}

      {isManager && (
        <button className="btn ghost" style={{ marginBottom: 10 }} onClick={() => setShowTimeOff(true)}>
          Time off requests
        </button>
      )}

      {view === 'day' && (
        <DayView
          shifts={shiftsByDate[ymd(anchor)] || []}
          locationsById={locationsById}
          profilesById={profilesById}
          onOpenDay={() => setSelectedDate(ymd(anchor))}
        />
      )}

      {(view === 'week' || view === 'biweek') && (
        <WeekView
          anchor={anchor}
          days={view === 'biweek' ? 14 : 7}
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
          profilesById={profilesById}
          isManager={isManager}
          offUserIds={offUserIds}
          saving={saving}
          onClose={() => setSelectedDate(null)}
          onSave={saveShift}
          onDelete={deleteShift}
        />
      )}

      {showBulk && (
        <BulkSchedule
          dateKeys={bulkKeys}
          floaters={floaters}
          locations={locations}
          shifts={bulkShifts}
          timeOff={bulkTimeOff}
          onClose={() => setShowBulk(false)}
          onSave={saveBulk}
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
