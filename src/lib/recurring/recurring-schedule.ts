export type RecurringFrequency = "MONTHLY" | "YEARLY";

/** Calendar arithmetic over YYYY-MM-DD values; recurrence remains anchored to startDate. */
export function nextRecurringDate(anchor: string, frequency: RecurringFrequency, after: string): string {
  const a = parseDate(anchor);
  const current = parseDate(after);
  if (frequency === "MONTHLY") {
    const monthIndex = current.year * 12 + current.month;
    const year = Math.floor((monthIndex + 1) / 12);
    const month = (monthIndex + 1) % 12;
    const day = Math.min(a.day, daysInMonth(year, month));
    return formatDate(year, month, day);
  }
  const year = current.year + 1;
  return formatDate(year, a.month, Math.min(a.day, daysInMonth(year, a.month)));
}

/** Finds the first anchored occurrence strictly after today, used when a plan resumes. */
export function nextUpcomingRecurringDate(anchor: string, frequency: RecurringFrequency, today: string): string {
  const normalizedAnchor = parseDate(anchor);
  let occurrence = formatDate(normalizedAnchor.year, normalizedAnchor.month, normalizedAnchor.day);
  while (occurrence <= today) occurrence = nextRecurringDate(anchor, frequency, occurrence);
  return occurrence;
}

export function colomboCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("A recurrence date must use YYYY-MM-DD format.");
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month - 1)) throw new Error("A recurrence date is invalid.");
  return { year, month: month - 1, day };
}
function daysInMonth(year: number, zeroBasedMonth: number) { return new Date(Date.UTC(year, zeroBasedMonth + 1, 0)).getUTCDate(); }
function formatDate(year: number, zeroBasedMonth: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(zeroBasedMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
