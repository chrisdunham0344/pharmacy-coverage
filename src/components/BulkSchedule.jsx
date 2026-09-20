import { useMemo, useState } from 'react';
import { Close } from './Icons.jsx';
import { fromYmd } from '../utils.js';

const OFF = '';

// Builds or edits a whole period at once, one floating pharmacist at a time.
// A day where that person already has two or more shifts is left alone here —
// those are rare and safer to edit in the day view.

export default function BulkSchedule({
  dateKeys,
  floaters,
  locations,
  shifts,
  onClose,
  onSave,
}) {
  const [floaterId, setFloaterId] = useState(floaters[0] ? floaters[0].id : '');
  const [defaultStart, setDefaultStart] = useState('09:00');
  const [defaultEnd, setDefaultEnd] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState(() => buildRows(floaters[0] ? floaters[0].id : ''));
  const [fillStore, setFillStore] = useState(locations[0] ? locations[0].id : '');
  const [fillScope, setFillScope] = useState('all');

  function buildRows(id) {
    const next = {};
    for (const key of dateKeys) {
      const mine = shifts.filter((s) => s.shift_date === key && s.pharmacist_id === id);
      if (mine.length > 1) {
        next[key] = { locked: true, count: mine.length };
      } else if (mine.length === 1) {
        next[key] = {
          existingId: mine[0].id,
          location_id: mine[0].location_id,
          start: String(mine[0].start_time).slice(0, 5),
          end: String(mine[0].end_time).slice(0, 5),
        };
      } else {
        next[key] = { existingId: null, location_id: OFF, start: '', end: '' };
      }
    }
    return next;
  }

  function switchFloater(id) {
    setFloaterId(id);
    setRows(buildRows(id));
    setError('');
  }

  function setStore(key, locationId) {
    setRows((r) => {
      const row = r[key];
      return {
        ...r,
        [key]: {
          ...row,
          location_id: locationId,
          start: locationId && !row.start ? defaultStart : row.start,
          end: locationId && !row.end ? defaultEnd : row.end,
        },
      };
    });
  }

  function setTime(key, field, value) {
    setRows((r) => ({ ...r, [key]: { ...r[key], [field]: value } }));
  }

  // Fills empty days in the chosen stretch with the store and default hours.
  function fill() {
    setRows((r) => {
      const next = { ...r };
      for (const key of dateKeys) {
        const dow = fromYmd(key).getDay();
        const weekend = dow === 0 || dow === 6;
        if (fillScope === 'weekdays' && weekend) continue;
        if (fillScope === 'weekends' && !weekend) continue;
        if (next[key].locked) continue;
        if (next[key].location_id) continue;
        next[key] = {
          ...next[key],
          location_id: fillStore,
          start: defaultStart,
          end: defaultEnd,
        };
      }
      return next;
    });
  }

  function clearAll() {
    setRows((r) => {
      const next = { ...r };
      for (const key of dateKeys) {
        if (next[key].locked) continue;
        next[key] = { ...next[key], location_id: OFF };
      }
      return next;
    });
  }

  const summary = useMemo(() => {
    let count = 0;
    for (const key of dateKeys) {
      if (!rows[key] || rows[key].locked) continue;
      if (rows[key].location_id) count++;
    }
    return count;
  }, [rows, dateKeys]);

  async function save() {
    const inserts = [];
    const updates = [];
    const deletes = [];

    for (const key of dateKeys) {
      const row = rows[key];
      if (!row || row.locked) continue;

      if (!row.location_id) {
        if (row.existingId) deletes.push(row.existingId);
        continue;
      }

      const start = row.start || defaultStart;
      const end = row.end || defaultEnd;
      if (end <= start) {
        setError(`Check the times on ${key} — the end is not after the start.`);
        return;
      }

      const record = {
        shift_date: key,
        location_id: row.location_id,
        pharmacist_id: floaterId,
        start_time: start,
        end_time: end,
      };

      if (row.existingId) updates.push({ id: row.existingId, ...record });
      else inserts.push(record);
    }

    setError('');
    setBusy(true);
    const ok = await onSave({ inserts, updates, deletes, floaterId });
    setBusy(false);
    if (ok) onClose();
    else setError('Some of that did not save. Check your connection and try again.');
  }

  if (floaters.length === 0) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-head">
            <h2>Build the schedule</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Close /></button>
          </div>
          <p className="empty">
            Nobody is marked as a floating pharmacist yet. Set that in the Pharmacists panel first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Build the schedule</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Close /></button>
        </div>

        {floaters.length > 1 && (
          <div className="toggle-row">
            {floaters.map((f) => (
              <button
                key={f.id}
                className={`chip-btn${f.id === floaterId ? ' on' : ''}`}
                onClick={() => switchFloater(f.id)}
              >
                {f.full_name}
              </button>
            ))}
          </div>
        )}

        <div className="form-card" style={{ marginBottom: 12 }}>
          <div className="row-2">
            <div className="field">
              <label htmlFor="ds">Usual start</label>
              <input id="ds" type="time" value={defaultStart} onChange={(e) => setDefaultStart(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="de">Usual end</label>
              <input id="de" type="time" value={defaultEnd} onChange={(e) => setDefaultEnd(e.target.value)} />
            </div>
          </div>

          <div className="row-2">
            <div className="field">
              <label htmlFor="fs">Fill empty days with</label>
              <select id="fs" value={fillStore} onChange={(e) => setFillStore(e.target.value)}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fsc">Which days</label>
              <select id="fsc" value={fillScope} onChange={(e) => setFillScope(e.target.value)}>
                <option value="all">Every day</option>
                <option value="weekdays">Mon to Fri</option>
                <option value="weekends">Sat and Sun</option>
              </select>
            </div>
          </div>

          <div className="row-2">
            <button className="btn ghost" onClick={clearAll}>Clear all</button>
            <button className="btn ghost" onClick={fill}>Fill</button>
          </div>
        </div>

        {dateKeys.map((key) => {
          const row = rows[key] || {};
          const d = fromYmd(key);

          return (
            <div key={key} className="shift-row" style={{ alignItems: 'center' }}>
              <div style={{ width: 58, flex: '0 0 auto' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                </div>
                <div style={{ fontWeight: 600 }}>{d.getDate()}</div>
              </div>

              {row.locked ? (
                <div className="meta" style={{ flex: 1 }}>
                  {row.count} shifts that day — edit this one in Day view
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <select
                    value={row.location_id || OFF}
                    onChange={(e) => setStore(key, e.target.value)}
                    style={{ flex: '1 1 130px' }}
                    aria-label={`Store for ${key}`}
                  >
                    <option value={OFF}>Off</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.abbrev}</option>
                    ))}
                  </select>

                  {row.location_id && (
                    <>
                      <input
                        type="time"
                        value={row.start || defaultStart}
                        onChange={(e) => setTime(key, 'start', e.target.value)}
                        style={{ flex: '1 1 92px' }}
                        aria-label={`Start time for ${key}`}
                      />
                      <input
                        type="time"
                        value={row.end || defaultEnd}
                        onChange={(e) => setTime(key, 'end', e.target.value)}
                        style={{ flex: '1 1 92px' }}
                        aria-label={`End time for ${key}`}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {error && <div className="error">{error}</div>}

        <div style={{ position: 'sticky', bottom: 0, background: '#fff', paddingTop: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
            {summary} {summary === 1 ? 'day' : 'days'} scheduled in this period
          </div>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save the whole period'}
          </button>
        </div>
      </div>
    </div>
  );
}
