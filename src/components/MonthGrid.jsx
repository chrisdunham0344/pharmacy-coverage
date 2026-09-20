import { monthCells, ymd } from '../utils.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MAX_PILLS = 3;

export default function MonthGrid({
  viewDate,
  shiftsByDate,
  locationsById,
  profilesById,
  onSelectDate,
}) {
  const cells = monthCells(viewDate);
  const todayKey = ymd(new Date());

  return (
    <>
      <div className="dow-row">
        {DOW.map((d, i) => (
          <div className="dow" key={i}>{d}</div>
        ))}
      </div>

      <div className="grid">
        {cells.map((cell) => {
          if (!cell.inMonth) return <div className="cell blank" key={cell.key} />;

          const dayShifts = shiftsByDate[cell.key] || [];
          const visible = dayShifts.slice(0, MAX_PILLS);
          const hidden = dayShifts.length - visible.length;

          return (
            <button
              className={`cell${cell.key === todayKey ? ' today' : ''}`}
              key={cell.key}
              onClick={() => onSelectDate(cell.key)}
              aria-label={`${cell.date.getDate()}, ${dayShifts.length} scheduled`}
            >
              <span className="daynum">{cell.date.getDate()}</span>

              {visible.map((s) => {
                const loc = locationsById[s.location_id];
                const person = s.pharmacist_id ? profilesById[s.pharmacist_id] : null;
                return (
                  <span
                    className="pill"
                    key={s.id}
                    style={
                      loc
                        ? { background: `${loc.color}1a`, color: loc.color, fontWeight: 600 }
                        : undefined
                    }
                  >
                    {loc ? loc.abbrev : '??'}
                    {person ? ` ${person.initials}` : ''}
                  </span>
                );
              })}

              {hidden > 0 && <span className="more">+{hidden}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}
