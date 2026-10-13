// How the pages spell ages, durations, money and dates. Every function takes the
// clock as an argument: a page ages rows by the server's `generatedAt`, never by its own clock.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Milliseconds from `from` to `now`; 0 for a time in the future or one that does not parse. */
export function elapsedMs(from: string, now: string): number {
  const span = Date.parse(now) - Date.parse(from);
  return Number.isFinite(span) && span > 0 ? span : 0;
}

/** A span as its two largest units: `40s`, `12m`, `1h 10m`, `3h`, `2d 4h`. */
export function spanLabel(ms: number): string {
  if (ms < MINUTE) return `${Math.floor(ms / SECOND)}s`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) {
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes === 0 ? `${Math.floor(ms / HOUR)}h` : `${Math.floor(ms / HOUR)}h ${minutes}m`;
  }
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours === 0 ? `${Math.floor(ms / DAY)}d` : `${Math.floor(ms / DAY)}d ${hours}h`;
}

/** How long it has been since `from`, as of `now`. */
export function ageLabel(from: string, now: string): string {
  return spanLabel(elapsedMs(from, now));
}

/** `polled 40s ago`, or `not polled yet` for a fleet no poll has reached. */
export function polledLabel(lastPolledAt: string | null, now: string): string {
  return lastPolledAt === null ? "not polled yet" : `polled ${ageLabel(lastPolledAt, now)} ago`;
}

/** The poll interval as `every 2m` or `every 90s`: whole seconds below an hour that is not whole minutes. */
export function intervalLabel(intervalMs: number): string {
  const wholeMinutes = intervalMs % MINUTE === 0;
  return `every ${intervalMs < HOUR && !wholeMinutes ? `${Math.round(intervalMs / SECOND)}s` : spanLabel(intervalMs)}`;
}

/** True for a currency written as a symbol (`$`, `€`, `£`): a single character that is not a letter. */
const isCurrencySymbol = (currency: string): boolean => /^[^\p{L}\d\s]$/u.test(currency);

/** An amount in its currency: a symbol goes in front (`$0.17`), a code Intl knows is formatted by it, any other code goes after the number (`0.17 XYZ`). */
export function formatMoney(amount: number, currency: string): string {
  if (isCurrencySymbol(currency)) return `${currency}${amount.toFixed(2)}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DAY_MONTH_TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

function format(formatter: Intl.DateTimeFormat, iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? formatter.format(time) : iso;
}

/** `18 Oct`, in the viewer's time zone. */
export function dateLabel(iso: string): string {
  return format(DAY_MONTH, iso);
}

/** What a credential's expiry reads as: `expires 18 Oct`, `expired 12 Oct` once it has passed, or `no expiry reported` where the service reports none. */
export function expiryText(expiresAt: string | null, expired = false): string {
  return expiresAt === null ? "no expiry reported" : `${expired ? "expired" : "expires"} ${dateLabel(expiresAt)}`;
}

/** The viewer's calendar day `iso` falls on, as midnight UTC of that day, so two of them are a whole number of days apart. */
const localDay = (iso: string): number => {
  const at = new Date(Date.parse(iso));
  return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate());
};

/**
 * How long ago an expiry passed, in the viewer's calendar days, so it agrees with the date `expiryText` shows:
 * `expired today` on the day it expired, `expired 1 day ago` the day after.
 */
export function expiredAgoText(expiresAt: string, now: string): string {
  const days = Math.max(0, Math.round((localDay(now) - localDay(expiresAt)) / DAY));
  return days === 0 ? "expired today" : `expired ${plural(days, "day")} ago`;
}

/** `12 Oct, 01:39`, in the viewer's time zone. */
export function dateTimeLabel(iso: string): string {
  return format(DAY_MONTH_TIME, iso);
}

/** `14:02`, in the viewer's time zone. */
export function timeLabel(iso: string): string {
  return format(TIME, iso);
}

/** `1 day`, `6 days`: a count with its noun. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
