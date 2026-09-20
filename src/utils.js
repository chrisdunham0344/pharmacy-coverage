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

export function weekTitle(date) {
  const start = weekStart(date);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString(
    undefined,
    sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' }
  );
  return `${startStr} – ${endStr}`;
}

export function weekCells(date) {
  const start = weekStart(date);
  const cells = [];
  for (let i = 0; i < 7; i++) {
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
