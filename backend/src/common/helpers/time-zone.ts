import { BadRequestException } from '@nestjs/common';

// GEN-06, FLT-03: flight times are entered in each airport's local time,
// stored in UTC and shown in local time. Time zones are IANA names from the
// airport data, e.g. Africa/Cairo, Asia/Dubai, Europe/Berlin.
//
// Built on the Intl API that ships with Node (full ICU data), so daylight
// saving is handled without an extra library.
//
// Used by Hazem (FLT-03, FLT-05, flight responses) and Aabsy (search by local
// date, flight details, e-ticket, days remaining for FLT-26).

// Local date-time without an offset, minutes precision: 2026-12-01T14:30
// (seconds ":00" are also accepted).
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

function assertTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) {
    throw new BadRequestException(`Unknown time zone "${timeZone}"`);
  }
}

// The wall-clock fields of an instant in a time zone.
function wallClock(date: Date, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return parts as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

// Offset of the time zone from UTC at an instant, in milliseconds
// (Cairo in winter: +2 h; Berlin in summer: +2 h, in winter: +1 h).
function offsetMs(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  const whole = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - whole;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

// "2026-12-01T14:30" in timeZone -> the UTC instant.
// Throws 400 for a malformed value, an unknown zone, or a local time that does
// not exist because the clocks jump forward (e.g. 02:30 in Berlin on the last
// Sunday of March). A time that happens twice when the clocks go back uses
// the first (earlier) occurrence.
export function localToUtc(local: string, timeZone: string): Date {
  assertTimeZone(timeZone);
  const m = LOCAL_DATE_TIME.exec(local ?? '');
  if (!m) {
    throw new BadRequestException(
      `"${local}" must be a local date and time such as 2026-12-01T14:30`,
    );
  }
  const [y, mo, d, h, mi, s = '0'] = m.slice(1).map((v) => v ?? '0');
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== +y ||
    check.getUTCMonth() !== +mo - 1 ||
    check.getUTCDate() !== +d ||
    check.getUTCHours() !== +h ||
    check.getUTCMinutes() !== +mi
  ) {
    throw new BadRequestException(`"${local}" is not a valid date and time`);
  }

  // Try the offsets in force a day before and a day after; whichever gives
  // back the same wall-clock time is right. Trying the earlier one first
  // picks the first occurrence of a repeated time.
  const candidates = [
    offsetMs(new Date(wall - DAY), timeZone),
    offsetMs(new Date(wall + DAY), timeZone),
  ];
  for (const offset of candidates) {
    const utc = new Date(wall - offset);
    if (offsetMs(utc, timeZone) === offset) return utc;
  }
  throw new BadRequestException(
    `${local.slice(0, 16)} does not exist in ${timeZone} (the clocks move forward then)`,
  );
}

// UTC instant -> "2026-12-01T14:30" in timeZone.
export function utcToLocal(date: Date | string, timeZone: string): string {
  assertTimeZone(timeZone);
  const w = wallClock(new Date(date), timeZone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

// The UTC offset in force at an instant, as "+02:00".
export function utcOffset(date: Date | string, timeZone: string): string {
  assertTimeZone(timeZone);
  const minutes = Math.round(offsetMs(new Date(date), timeZone) / MINUTE);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// What every flight response shows for a time (GEN-06):
// { utc: '2026-12-01T12:30:00.000Z', local: '2026-12-01T14:30',
//   utcOffset: '+02:00', timeZone: 'Africa/Cairo' }
export interface ZonedTime {
  utc: string;
  local: string;
  utcOffset: string;
  timeZone: string;
}

export function toZonedTime(date: Date | string, timeZone: string): ZonedTime {
  return {
    utc: new Date(date).toISOString(),
    local: utcToLocal(date, timeZone),
    utcOffset: utcOffset(date, timeZone),
    timeZone,
  };
}

// The local calendar date of an instant: "2026-12-02".
export function localDate(date: Date | string, timeZone: string): string {
  return utcToLocal(date, timeZone).slice(0, 10);
}

// A local calendar day as a UTC window [start, end): use it to find flights
// departing on a local date (FLT-11):
//   const { start, end } = localDayRangeUtc('2026-12-02', 'Africa/Cairo');
//   find({ departureAt: { $gte: start, $lt: end } })
export function localDayRangeUtc(
  date: string,
  timeZone: string,
): { start: Date; end: Date } {
  const m = LOCAL_DATE.exec(date ?? '');
  if (!m) {
    throw new BadRequestException(
      `"${date}" must be a date such as 2026-12-02`,
    );
  }
  const next = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  const nextDay = next.toISOString().slice(0, 10);
  return {
    start: startOfLocalDay(date, timeZone),
    end: startOfLocalDay(nextDay, timeZone),
  };
}

// Midnight may not exist on a day the clocks jump at 00:00, so take the first
// minute of the day that does exist.
function startOfLocalDay(date: string, timeZone: string): Date {
  for (let minutes = 0; minutes <= 120; minutes += 30) {
    const hh = pad(Math.floor(minutes / 60));
    const mm = pad(minutes % 60);
    try {
      return localToUtc(`${date}T${hh}:${mm}`, timeZone);
    } catch (e) {
      if (minutes === 120) throw e;
    }
  }
  throw new BadRequestException(`"${date}" is not a valid date`);
}

// Whole calendar days from `now` to `target`, both counted in the local date
// of timeZone (conventions.md: "days remaining is counted in the airport's or
// hotel's local date"). Negative once the date has passed.
// Use with refundPercent() from cancellation-tiers.ts.
export function localDaysUntil(
  target: Date | string,
  timeZone: string,
  now: Date = new Date(),
): number {
  const a = Date.parse(`${localDate(now, timeZone)}T00:00:00Z`);
  const b = Date.parse(`${localDate(target, timeZone)}T00:00:00Z`);
  return Math.round((b - a) / DAY);
}
