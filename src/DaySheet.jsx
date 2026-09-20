import { useState } from 'react';
import { Close, Plus, Trash, Pencil } from './Icons.jsx';
import { fmtTime, longDate } from '../utils.js';

const BLANK = {
  id: null,
  location_id: '',
  pharmacist_id: '',
  start_time: '09:00',
  end_time: '18:00',
  notes: '',
};

export default function DaySheet({
  dateKey,
  shifts,
  locations,
  profiles,
  isManager,
  offUserIds,
  saving,
  onClose,
  onSave,
  onDelete,
}) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  const off = offUserIds || new Set();
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l]));
  const profilesById = Object.fromEntries(profiles.map((p) => [p.id, p]));

  function openNew() {
    setError('');
    setForm({ ...BLANK, location_id: locations[0] ? locations[0].id : '' });
  }

  function openEdit(shift) {
    setError('');
    setForm({
      id: shift.id,
      location_id: shift.location_id,
      pharmacist_id: shift.pharmacist_id || '',
      start_time: (shift.start_time || '09:00').slice(0, 5),
      end_time: (shift.end_time || '18:00').slice(0, 5),
      notes: shift.notes || '',
    });
  }

  async function submit() {
    if (!form.location_id) return setError('Pick a location.');
    if (!form.start_time || !form.end_time) return setError('Enter a start and end time.');
    setError('');
    const ok = await onSave({
      id: form.id,
      shift_date: dateKey,
      location_id: form.location_id,
      pharmacist_id: form.pharmacist_id || null,
      start_time: form.start_time,
      end_time: form.end_time,
      notes: form.notes.trim() || null,
    });
    if (ok) setForm(null);
    else setError('That did not save. Check your connection and try again.');
  }

  const sorted = [...shifts].sort((a, b) => {
    const la = locationsById[a.location_id];
    const lb = locationsById[b.location_id];
    const oa = la ? la.sort_order : 99;
    const ob = lb ? lb.sort_order : 99;
    if (oa !== ob) return oa - ob;
    return String(a.start_time).localeCompare(String(b.start_time));
  });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{longDate(dateKey)}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </div>

        {sorted.length === 0 && !form && (
          <p className="empty">No one is scheduled yet.</p>
        )}

        {sorted.map((s) => {
          const loc = locationsById[s.location_id];
          const person = s.pharmacist_id ? profilesById[s.pharmacist_id] : null;
          return (
            <div className="shift-row" key={s.id}>
              <span className="bar" style={{ background: loc ? loc.color : '#556' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="who">{person ? person.full_name : 'Open shift'}</div>
                <div className="meta">
                  {loc ? loc.name : 'Unknown store'} · {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                  {s.notes ? ` · ${s.notes}` : ''}
                </div>
                {s.pharmacist_id && off.has(s.pharmacist_id) && (
                  <div className="error" style={{ fontSize: 12, marginTop: 2 }}>
                    Has approved time off this day
                  </div>
                )}
              </div>
              {isManager && (
                <>
                  <button className="icon-btn" onClick={() => openEdit(s)} aria-label="Edit shift">
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => {
                      if (window.confirm('Remove this shift?')) onDelete(s.id);
                    }}
                    aria-label="Remove shift"
                  >
                    <Trash size={16} />
                  </button>
                </>
              )}
            </div>
          );
        })}

        {isManager && !form && (
          <button className="btn ghost" onClick={openNew} style={{ marginTop: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Plus size={16} /> Add a shift
            </span>
          </button>
        )}

        {isManager && form && (
          <div className="form-card">
            <div className="field">
              <label htmlFor="loc">Location</label>
              <select
                id="loc"
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="ph">Pharmacist</label>
              <select
                id="ph"
                value={form.pharmacist_id}
                onChange={(e) => setForm({ ...form, pharmacist_id: e.target.value })}
              >
                <option value="">Leave open</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </div>

            <div className="row-2">
              <div className="field">
                <label htmlFor="start">Starts</label>
                <input
                  id="start"
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="end">Ends</label>
                <input
                  id="end"
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="notes">Note (optional)</label>
              <input
                id="notes"
                type="text"
                placeholder="Covering until close"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            {form.pharmacist_id && off.has(form.pharmacist_id) && (
              <div className="error">
                Heads up: this pharmacist has approved time off on this day. You can still
                schedule them.
              </div>
            )}

            {error && <div className="error">{error}</div>}

            <div className="row-2" style={{ marginTop: 10 }}>
              <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn" onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : 'Save shift'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
