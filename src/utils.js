// Local-date helpers. We never use toISOString() for dates, because that
// converts to UTC and can shift the day by one depending on time zone.

export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromYmd(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

export function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function longDate(dateStr) {
  return fromYmd(dateStr).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function dayTitle(date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function weekStart(date) {
  return addDays(date, -date.getDay());
}

export function weekTitle(date, days = 7) {
  const start = weekStart(date);
  const end = addDays(start, days - 1);
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString(
    undefined,
    sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' }
  );
  return `${startStr} – ${endStr}`;
}

export function weekCells(date, days = 7) {
  const start = weekStart(date);
  const cells = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    cells.push({ date: d, key: ymd(d) });
  }
  return cells;
}

// Returns 42 cells (6 weeks) so the grid height never jumps between months.
export function monthCells(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: d, key: ymd(d), inMonth: d.getMonth() === month });
  }
  return cells;
}

export function monthRange(viewDate) {
  const cells = monthCells(viewDate);
  return { from: cells[0].key, to: cells[41].key };
}

// '14:30:00' -> '2:30p'   '09:00:00' -> '9a'
export function fmtTime(t) {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  let h = Number(hStr);
  const m = Number(mStr);
  const suffix = h >= 12 ? 'p' : 'a';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${suffix}` : `${h}:${String(m).padStart(2, '0')}${suffix}`;
}

export function initialsFrom(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Turns database and network errors into something a pharmacist can act on.
// The database now enforces the scheduling rules, so these messages are what
// people actually see when a rule is broken.
export function friendlyError(err, fallback = 'That did not save. Check your connection and try again.') {
  const msg = String((err && (err.message || err.details)) || err || '');

  if (msg.includes('shifts_end_after_start')) return 'The end time has to be after the start time.';
  if (msg.includes('shifts_no_overlap')) return 'That overlaps another shift for the same pharmacist.';
  if (msg.includes('SHIFT_ASSIGNEE_NOT_SCHEDULABLE'))
    return 'That person cannot be scheduled. They need to be approved, active, and marked as a floater.';
  if (msg.includes('SCHEDULE_CHANGED_ELSEWHERE'))
    return 'Someone else changed this schedule while you were editing. Close this and open Make schedule again.';
  if (msg.includes('LAST_MANAGER')) return 'There has to be at least one manager. Make someone else a manager first.';
  if (msg.includes('NOT_MANAGER')) return 'Only a manager can do that.';
  if (msg.includes('NOT_A_FLOATER')) return 'Only floating pharmacists can request time off.';
  if (msg.includes('time_off_dates')) return 'The last day cannot be before the first day.';
  if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network'))
    return 'No connection. Check your internet and try again.';
  return fallback;
}

// '2026-09-27', '09:00:00', '18:00:00' -> 'Sun, Sep 27, 9a–6p'
export function shiftLine(dateStr, start, end) {
  const d = fromYmd(dateStr).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${d}, ${fmtTime(start)}–${fmtTime(end)}`;
}
