import { fmtTime, weekCells, ymd } from '../utils.js';

export default function WeekView({
  anchor,
  days = 7,
  shiftsByDate,
  locationsById,
  profilesById,
  onSelectDate,
}) {
  const cells = weekCells(anchor, days);
  const todayKey = ymd(new Date());

  return (
    <div>
      {cells.map((cell, index) => {
        const list = shiftsByDate[cell.key] || [];

        const startsSecondWeek = days > 7 && index === 7;

        return (
          <button
            className={`week-row${cell.key === todayKey ? ' today' : ''}`}
            key={cell.key}
            onClick={() => onSelectDate(cell.key)}
            style={startsSecondWeek ? { marginTop: 14 } : undefined}
          >
            <span className="wd">
              {cell.date.toLocaleDateString(undefined, { weekday: 'short' })}
              <span className="num">{cell.date.getDate()}</span>
            </span>

            <span className="week-shifts">
              {list.length === 0 && <span className="meta">Nobody floating</span>}

              {list.map((s) => {
                const loc = locationsById[s.location_id];
                const person = s.pharmacist_id ? profilesById[s.pharmacist_id] : null;
                return (
                  <span
                    className="tag"
                    key={s.id}
                    style={
                      loc ? { borderColor: loc.color, background: `${loc.color}12` } : undefined
                    }
                  >
                    <span className="dot" style={{ background: loc ? loc.color : '#94a3b8' }} />
                    {loc ? loc.abbrev : '??'} · {person ? person.full_name.split(' ')[0] : 'Open'} ·{' '}
                    {fmtTime(s.start_time)}
                  </span>
                );
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
