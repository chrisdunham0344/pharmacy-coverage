import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient.js';
import { sendPush } from '../push.js';
import { Close, Trash } from './Icons.jsx';
import { longDate, ymd } from '../utils.js';

function rangeLabel(r) {
  return r.start_date === r.end_date
    ? longDate(r.start_date)
    : `${longDate(r.start_date)} to ${longDate(r.end_date)}`;
}

const STATUS_COLOR = {
  pending: '#8494b0',
  approved: '#3fbf8f',
  denied: '#e0575f',
};

export default function TimeOffPanel({ me, profilesById, isManager, onClose, onChanged }) {
  const isFloater = Boolean(me && me.is_floater);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const today = ymd(new Date());
  const [form, setForm] = useState({ start_date: today, end_date: today, note: '' });

  async function load() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('time_off')
      .select('*')
      .gte('end_date', today)
      .order('start_date');
    setLoading(false);
    if (err) {
      setError('Requests could not load.');
      return;
    }
    setError('');
    setRequests(data || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitRequest() {
    if (!form.start_date || !form.end_date) return setError('Pick your dates.');
    if (form.end_date < form.start_date) return setError('The end date is before the start date.');

    setBusy(true);
    const { error: err } = await supabase.from('time_off').insert({
      user_id: me.id,
      start_date: form.start_date,
      end_date: form.end_date,
      note: form.note.trim() || null,
      status: 'pending',
    });
    setBusy(false);

    if (err) {
      setError('That did not save. Try again.');
      return;
    }

    setError('');
    setForm({ start_date: today, end_date: today, note: '' });
    sendPush({
      kind: 'timeoff_request',
      dates:
        form.start_date === form.end_date
          ? form.start_date
          : `${form.start_date} to ${form.end_date}`,
    });
    await load();
    if (onChanged) onChanged();
  }

  async function decide(request, status) {
    setBusy(true);
    const { error: err } = await supabase
      .from('time_off')
      .update({ status, decided_by: me.id, decided_at: new Date().toISOString() })
      .eq('id', request.id);
    setBusy(false);

    if (err) {
      setError('That did not save. Try again.');
      return;
    }

    sendPush({
      userIds: [request.user_id],
      title: status === 'approved' ? 'Time off approved' : 'Time off denied',
      body: `${rangeLabel(request)} — ${status}.`,
    });
    await load();
    if (onChanged) onChanged();
  }

  async function withdraw(request) {
    if (!window.confirm('Withdraw this request?')) return;
    setBusy(true);
    await supabase.from('time_off').delete().eq('id', request.id);
    setBusy(false);
    await load();
    if (onChanged) onChanged();
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const mine = requests.filter((r) => r.user_id === me.id);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{isFloater ? 'Request time off' : 'Time off requests'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </div>

        {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}

        {isManager && (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
              Waiting on you
            </div>
            {pending.length === 0 && <p className="empty">Nothing waiting.</p>}
            {pending.map((r) => (
              <div className="shift-row" key={r.id} style={{ flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="who">
                    {profilesById[r.user_id] ? profilesById[r.user_id].full_name : 'Someone'}
                  </div>
                  <div className="meta">
                    {rangeLabel(r)}
                    {r.note ? ` · ${r.note}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="chip-btn" disabled={busy} onClick={() => decide(r, 'denied')}>
                    Deny
                  </button>
                  <button className="chip-btn on" disabled={busy} onClick={() => decide(r, 'approved')}>
                    Approve
                  </button>
                </div>
              </div>
            ))}
            {!isFloater && (
              <>
                <div style={{ fontSize: 13, color: 'var(--muted)', margin: '18px 0 8px' }}>
                  Coming up
                </div>
                {requests.filter((r) => r.status !== 'pending').length === 0 && (
                  <p className="empty">No approved or denied requests ahead.</p>
                )}
                {requests
                  .filter((r) => r.status !== 'pending')
                  .map((r) => (
                    <div className="shift-row" key={r.id}>
                      <span className="bar" style={{ background: STATUS_COLOR[r.status] }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="who">
                          {profilesById[r.user_id] ? profilesById[r.user_id].full_name : 'Someone'}
                        </div>
                        <div className="meta">
                          {rangeLabel(r)} · {r.status}
                        </div>
                      </div>
                    </div>
                  ))}
              </>
            )}
            <div style={{ height: 18 }} />
          </>
        )}

        {isFloater && (
        <>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Your requests</div>

        {loading && <p className="empty">Loading…</p>}
        {!loading && mine.length === 0 && <p className="empty">You have no upcoming requests.</p>}

        {mine.map((r) => (
          <div className="shift-row" key={r.id}>
            <span className="bar" style={{ background: STATUS_COLOR[r.status] }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="who">{rangeLabel(r)}</div>
              <div className="meta">
                {r.status === 'pending' ? 'Waiting for a manager' : r.status}
                {r.note ? ` · ${r.note}` : ''}
              </div>
            </div>
            {r.status === 'pending' && (
              <button className="icon-btn" onClick={() => withdraw(r)} aria-label="Withdraw request">
                <Trash size={16} />
              </button>
            )}
          </div>
        ))}

        <div className="form-card">
          <div style={{ fontSize: 13, marginBottom: 10 }}>Ask for time off</div>

          <div className="row-2">
            <div className="field">
              <label htmlFor="to-start">First day</label>
              <input
                id="to-start"
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    start_date: e.target.value,
                    end_date: f.end_date < e.target.value ? e.target.value : f.end_date,
                  }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="to-end">Last day</label>
              <input
                id="to-end"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="to-note">Reason (optional)</label>
            <input
              id="to-note"
              type="text"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>

          <button className="btn" onClick={submitRequest} disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
