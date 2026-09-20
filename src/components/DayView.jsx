import { fmtTime } from '../utils.js';
import { Plus } from './Icons.jsx';

export default function DayView({
  dateKey,
  shifts,
  locations,
  profilesById,
  isManager,
  onEdit,
  onAdd,
}) {
  const byLocation = new Map(locations.map((l) => [l.id, []]));
  for (const s of shifts) {
    if (!byLocation.has(s.location_id)) byLocation.set(s.location_id, []);
    byLocation.get(s.location_id).push(s);
  }

  const covered = shifts.length;

  return (
    <div>
      <div className="day-head">
        <span className="count">
          {covered === 0
            ? 'Nobody scheduled'
            : `${covered} ${covered === 1 ? 'shift' : 'shifts'}`}
        </span>
        {isManager && (
          <button className="chip-btn" onClick={onAdd}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Add
            </span>
          </button>
        )}
      </div>

      {locations.map((loc) => {
        const list = (byLocation.get(loc.id) || []).sort((a, b) =>
          String(a.start_time).localeCompare(String(b.start_time))
        );

        return (
          <div className="store-block" key={loc.id}>
            <div className="store-head">
              <span className="swatch" style={{ background: loc.color }} />
              {loc.name}
            </div>

            {list.length === 0 && <div className="uncovered">No pharmacist assigned</div>}

            {list.map((s) => {
              const person = s.pharmacist_id ? profilesById[s.pharmacist_id] : null;
              return (
                <button
                  className="shift-row"
                  key={s.id}
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={onEdit}
                >
                  <span className="bar" style={{ background: loc.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="who">{person ? person.full_name : 'Open shift'}</div>
                    <div className="meta">
                      {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                      {s.notes ? ` · ${s.notes}` : ''}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}

      {locations.length === 0 && <p className="empty">No stores set up yet.</p>}
    </div>
  );
}
