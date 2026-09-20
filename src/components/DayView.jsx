import { fmtTime } from '../utils.js';

// Only floating pharmacists are scheduled, so a store with nobody listed is
// normal — it simply has no floater that day. Nothing is flagged as missing.

export default function DayView({ shifts, locationsById, profilesById, onOpenDay }) {
  const groups = [];
  for (const s of shifts) {
    let g = groups.find((x) => x.locationId === s.location_id);
    if (!g) {
      g = { locationId: s.location_id, location: locationsById[s.location_id], list: [] };
      groups.push(g);
    }
    g.list.push(s);
  }

  groups.sort((a, b) => (a.location?.sort_order ?? 99) - (b.location?.sort_order ?? 99));
  for (const g of groups) {
    g.list.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }

  return (
    <div>
      <div className="day-head">
        <span className="count">
          {shifts.length === 0
            ? 'No floating pharmacist scheduled'
            : `${shifts.length} scheduled`}
        </span>
      </div>

      {groups.map((g) => (
        <div className="store-block" key={g.locationId}>
          <div className="store-head">
            <span className="swatch" style={{ background: g.location ? g.location.color : '#94a3b8' }} />
            {g.location ? g.location.name : 'Unknown store'}
          </div>

          {g.list.map((s) => {
            const person = s.pharmacist_id ? profilesById[s.pharmacist_id] : null;
            return (
              <button
                className="shift-row"
                key={s.id}
                style={{ width: '100%', textAlign: 'left' }}
                onClick={onOpenDay}
              >
                <span
                  className="bar"
                  style={{ background: g.location ? g.location.color : '#94a3b8' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="who">{person ? person.full_name : 'Not assigned yet'}</div>
                  <div className="meta">
                    {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                    {s.notes ? ` · ${s.notes}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
