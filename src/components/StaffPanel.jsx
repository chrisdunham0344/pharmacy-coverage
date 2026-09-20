import { useState } from 'react';
import { Close } from './Icons.jsx';
import { initialsFrom } from '../utils.js';

export default function StaffPanel({ profiles, onClose, onSave }) {
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing.full_name.trim()) return setError('Enter a name.');
    setBusy(true);
    const ok = await onSave({
      id: editing.id,
      full_name: editing.full_name.trim(),
      initials: (editing.initials.trim() || initialsFrom(editing.full_name)).slice(0, 3).toUpperCase(),
      role: editing.role,
      active: editing.active,
      approved: editing.approved,
      is_floater: editing.is_floater,
    });
    setBusy(false);
    if (ok) {
      setEditing(null);
      setError('');
    } else {
      setError('That did not save. Try again.');
    }
  }

  async function approve(p) {
    setBusy(true);
    const ok = await onSave({
      id: p.id,
      full_name: p.full_name,
      initials: p.initials,
      role: p.role,
      active: true,
      approved: true,
      is_floater: p.is_floater,
    });
    setBusy(false);
    if (!ok) setError('That did not save. Try again.');
  }

  const pending = profiles.filter((p) => !p.approved);
  const approvedList = profiles.filter((p) => p.approved);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Pharmacists</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </div>

        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Pharmacists sign up with their work email. Approve them here before they can see the
          schedule.
        </p>

        {pending.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
              Waiting for approval
            </div>
            {pending.map((p) => (
              <div className="shift-row" key={p.id}>
                <span className="bar" style={{ background: '#e0a44c' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="who">{p.full_name}</div>
                  <div className="meta">Signed up, not approved yet</div>
                </div>
                <button
                  className="chip-btn on"
                  disabled={busy}
                  onClick={() => approve(p)}
                >
                  Approve
                </button>
              </div>
            ))}
            <div style={{ height: 18 }} />
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Approved</div>
          </>
        )}

        {approvedList.length === 0 && <p className="empty">No one is approved yet.</p>}

        {approvedList.map((p) => (
          <div className="shift-row" key={p.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="who">{p.full_name}</div>
              <div className="meta">
                {p.initials} · {p.is_floater ? 'Floating pharmacist' : 'Store pharmacist'}
                {p.role === 'manager' ? ' · Manager' : ''}
                {p.active ? '' : ' · Inactive'}
              </div>
            </div>
            <button className="chip-btn" onClick={() => { setError(''); setEditing({ ...p }); }}>
              Edit
            </button>
          </div>
        ))}

        {editing && (
          <div className="form-card">
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input
                id="name"
                type="text"
                value={editing.full_name}
                onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
              />
            </div>

            <div className="row-2">
              <div className="field">
                <label htmlFor="init">Initials on the calendar</label>
                <input
                  id="init"
                  type="text"
                  maxLength={3}
                  value={editing.initials}
                  onChange={(e) => setEditing({ ...editing, initials: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="role">Access</label>
                <select
                  id="role"
                  value={editing.role}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                >
                  <option value="pharmacist">Pharmacist (view only)</option>
                  <option value="manager">Manager (can edit)</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="floater">Do they float between stores?</label>
              <select
                id="floater"
                value={editing.is_floater ? 'yes' : 'no'}
                onChange={(e) => setEditing({ ...editing, is_floater: e.target.value === 'yes' })}
              >
                <option value="no">No — works at one store, view only</option>
                <option value="yes">Yes — can be put on the schedule</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="active">Status</label>
              <select
                id="active"
                value={editing.active ? 'yes' : 'no'}
                onChange={(e) => setEditing({ ...editing, active: e.target.value === 'yes' })}
              >
                <option value="yes">Active</option>
                <option value="no">Inactive — hide from the shift list</option>
              </select>
            </div>

            {error && <div className="error">{error}</div>}

            <div className="row-2" style={{ marginTop: 10 }}>
              <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
