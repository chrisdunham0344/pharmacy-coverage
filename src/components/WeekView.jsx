import { fmtTime, weekCells, ymd } from '../utils.js';

export default function WeekView({
  anchor,
  shiftsByDate,
  locationsById,
  profilesById,
  locationCount,
  onSelectDate,
  showGaps,
}) {
  const cells = weekCells(anchor);
  const todayKey = ymd(new Date());

  return (
    <div>
      {cells.map((cell) => {
        const list = shiftsByDate[cell.key] || [];
        const coveredStores = new Set(list.map((s) => s.location_id)).size;
        const short = showGaps && coveredStores < locationCount;

        return (
          <button
            className={`week-row${cell.key === todayKey ? ' today' : ''}`}
            key={cell.key}
            onClick={() => onSelectDate(cell.key)}
          >
            <span className="wd">
              {cell.date.toLocaleDateString(undefined, { weekday: 'short' })}
              <span className="num">{cell.date.getDate()}</span>
            </span>

            <span className="week-shifts">
              {list.length === 0 && <span className="uncovered">Nobody scheduled</span>}

              {list.map((s) => {
                const loc = locationsById[s.location_id];
                const person = s.pharmacist_id ? profilesById[s.pharmacist_id] : null;
                return (
                  <span className="tag" key={s.id}>
                    <span className="dot" style={{ background: loc ? loc.color : '#94a3b8' }} />
                    {loc ? loc.abbrev : '??'} · {person ? person.full_name.split(' ')[0] : 'Open'} ·{' '}
                    {fmtTime(s.start_time)}
                  </span>
                );
              })}

              {short && list.length > 0 && (
                <span className="uncovered">
                  {locationCount - coveredStores} store
                  {locationCount - coveredStores === 1 ? '' : 's'} uncovered
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
