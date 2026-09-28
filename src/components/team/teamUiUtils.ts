export const AVATAR_COLORS = [
  '#5b7cfa',
  '#9061f9',
  '#0fa36b',
  '#f0578c',
  '#f59e0b',
  '#06b6d4',
  '#ec4899',
  '#8b5cf6',
  '#10b981',
  '#6366f1',
];

export function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function formatPtoSpan(span: {
  startDate: string;
  endDate: string;
  startHalfDay?: string;
  endHalfDay?: string;
}): string {
  const isSingleDay = span.startDate === span.endDate;
  if (isSingleDay) {
    if (span.startHalfDay === 'morning') return `${span.startDate} (Morning)`;
    if (span.startHalfDay === 'afternoon') return `${span.startDate} (Afternoon)`;
    return span.startDate;
  }
  let str = `${span.startDate}`;
  if (span.startHalfDay && span.startHalfDay !== 'full') {
    str += ` (${span.startHalfDay === 'morning' ? 'AM' : 'PM'})`;
  }
  str += ` → ${span.endDate}`;
  if (span.endHalfDay && span.endHalfDay !== 'full') {
    str += ` (${span.endHalfDay === 'morning' ? 'AM' : 'PM'})`;
  }
  return str;
}
