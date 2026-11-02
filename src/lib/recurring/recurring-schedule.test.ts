import assert from "node:assert/strict";
import test from "node:test";
import { colomboCalendarDate, nextRecurringDate, nextUpcomingRecurringDate } from "./recurring-schedule";

test("monthly recurrence retains the original day anchor through short months", () => {
  assert.equal(nextRecurringDate("2026-01-31", "MONTHLY", "2026-01-31"), "2026-02-28");
  assert.equal(nextRecurringDate("2026-01-31", "MONTHLY", "2026-02-28"), "2026-03-31");
  assert.equal(nextRecurringDate("2028-01-31", "MONTHLY", "2028-01-31"), "2028-02-29");
  assert.equal(nextRecurringDate("2028-01-31", "MONTHLY", "2028-02-29"), "2028-03-31");
});

test("yearly February 29 returns to leap day after non-leap years", () => {
  assert.equal(nextRecurringDate("2028-02-29", "YEARLY", "2028-02-29"), "2029-02-28");
  assert.equal(nextRecurringDate("2028-02-29", "YEARLY", "2029-02-28"), "2030-02-28");
  assert.equal(nextRecurringDate("2028-02-29", "YEARLY", "2030-02-28"), "2031-02-28");
  assert.equal(nextRecurringDate("2028-02-29", "YEARLY", "2031-02-28"), "2032-02-29");
});

test("resume chooses the next anchored date after Colombo today without replaying backlog", () => {
  assert.equal(nextUpcomingRecurringDate("2026-01-31", "MONTHLY", "2026-04-30"), "2026-05-31");
  assert.equal(colomboCalendarDate(new Date("2026-11-01T19:00:00.000Z")), "2026-11-02");
});
