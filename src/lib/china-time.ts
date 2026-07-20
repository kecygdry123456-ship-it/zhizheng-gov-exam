const CHINA_TIME_ZONE = "Asia/Shanghai";

function chinaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function chinaDateKey(date: Date) {
  const parts = chinaDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function chinaDateValue(date: Date) {
  return new Date(`${chinaDateKey(date)}T00:00:00.000Z`);
}

export function chinaDayStart(date: Date) {
  return new Date(`${chinaDateKey(date)}T00:00:00+08:00`);
}

export function chinaNextDayStart(date: Date) {
  const next = chinaDayStart(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function chinaWeekStart(date: Date) {
  const key = chinaDateKey(date);
  const localWeekday = new Date(`${key}T12:00:00+08:00`).getUTCDay();
  const start = chinaDayStart(date);
  start.setUTCDate(start.getUTCDate() - ((localWeekday + 6) % 7));
  return start;
}

export function chinaWeekDate(date: Date) {
  return chinaDateValue(chinaWeekStart(date));
}
