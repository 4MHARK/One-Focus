import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeReminders, DEFAULT_REMINDERS, formatClockTime, nextOccurrence, normalizeReminder,
  reminderCopy, reminderIdentifier, shiftTime,
} from './reminders.ts';

test('the defaults are a morning and an evening reminder, both on', () => {
  assert.deepEqual(DEFAULT_REMINDERS.morning, { enabled: true, hour: 8, minute: 0 });
  assert.deepEqual(DEFAULT_REMINDERS.evening, { enabled: true, hour: 20, minute: 0 });
});

test('a time steps forward, wrapping past midnight', () => {
  assert.deepEqual(shiftTime(8, 0, 15), { hour: 8, minute: 15 });
  assert.deepEqual(shiftTime(23, 45, 30), { hour: 0, minute: 15 });
});

test('a time steps backward, wrapping before midnight', () => {
  assert.deepEqual(shiftTime(0, 15, -30), { hour: 23, minute: 45 });
});

test('the next occurrence is today while the time is still ahead', () => {
  const from = new Date(2026, 9, 2, 7, 0, 0);
  const next = nextOccurrence(8, 0, from);

  assert.equal(next.getDate(), 2);
  assert.equal(next.getHours(), 8);
  assert.equal(next.getMinutes(), 0);
});

test('the next occurrence rolls to tomorrow once the time has passed', () => {
  const from = new Date(2026, 9, 2, 9, 0, 0);
  const next = nextOccurrence(8, 0, from);

  assert.equal(next.getDate(), 3);
  assert.equal(next.getHours(), 8);
});

test('a reminder due exactly now rolls to tomorrow rather than counting as upcoming', () => {
  const from = new Date(2026, 9, 2, 8, 0, 0);

  assert.equal(nextOccurrence(8, 0, from).getDate(), 3);
});

test('times are labelled in a predictable 12-hour format', () => {
  assert.equal(formatClockTime(8, 0), '8:00 AM');
  assert.equal(formatClockTime(8, 5), '8:05 AM');
  assert.equal(formatClockTime(12, 0), '12:00 PM');
  assert.equal(formatClockTime(0, 0), '12:00 AM');
  assert.equal(formatClockTime(20, 30), '8:30 PM');
});

test('an out-of-range time is clamped rather than kept', () => {
  assert.deepEqual(normalizeReminder({ enabled: true, hour: 99, minute: -5 }), { enabled: true, hour: 23, minute: 0 });
  assert.deepEqual(normalizeReminder({ enabled: true, hour: 8.7, minute: 30.9 }), { enabled: true, hour: 8, minute: 30 });
});

test('only the enabled reminders are scheduled', () => {
  const scheduled = activeReminders({ morning: { enabled: true, hour: 7, minute: 30 }, evening: { enabled: false, hour: 20, minute: 0 } });

  assert.deepEqual(scheduled.map((item) => item.kind), ['morning']);
  assert.equal(scheduled[0].hour, 7);
  assert.equal(scheduled[0].minute, 30);
  assert.ok(scheduled[0].title.length > 0);
  assert.ok(scheduled[0].body.length > 0);
});

test('a reminder being switched off removes it from what gets scheduled', () => {
  const bothOff = activeReminders({ morning: { enabled: false, hour: 8, minute: 0 }, evening: { enabled: false, hour: 20, minute: 0 } });

  assert.deepEqual(bothOff, []);
});

test('each reminder has a stable identifier so re-scheduling replaces rather than stacks', () => {
  assert.equal(reminderIdentifier('morning'), 'one-thing-morning');
  assert.equal(reminderIdentifier('evening'), 'one-thing-evening');
  assert.deepEqual(reminderIdentifier('morning'), activeReminders(DEFAULT_REMINDERS)[0].identifier);
});

test('every reminder kind has copy of its own', () => {
  assert.notDeepEqual(reminderCopy('morning'), reminderCopy('evening'));
});
