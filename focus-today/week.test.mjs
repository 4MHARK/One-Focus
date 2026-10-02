import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardWeek, weekSummary } from './week.ts';
import { DEFAULT_REMINDERS } from './reminders.ts';

// --- fixtures ----------------------------------------------------------------------

const entry = (overrides = {}) => ({
  id: 'p1', title: 'Project one', appName: 'Example', kind: 'Coding', workModes: ['Planning'],
  description: '', outcome: 'Outcome', todayGoal: '', firstStep: '', todayReason: '',
  done: '', remaining: '', blocker: '', deadline: '', remainingSessions: 2, priority: 'normal',
  state: 'planned', ...overrides,
});
const plannedDay = (overrides = {}) => ({
  date: '2026-10-05', available: true, minutes: 180, projectId: null, reason: '', locked: false, edited: false, ...overrides,
});
const checkIn = (overrides = {}) => ({
  date: '2026-10-05', projectId: 'p1', status: 'Finished',
  accomplished: '', remaining: '', blocker: '', savedAt: '2026-10-05T20:00:00.000Z', ...overrides,
});
const baseData = (overrides = {}) => ({
  entries: [entry(), entry({ id: 'p2', title: 'Project two' })],
  checkIns: {},
  legacyCheckIn: null,
  todayProjectId: 'p1',
  availability: [],
  selectedProjectIds: ['p1'],
  acceptedPlan: null,
  todayActionProgress: {},
  reminders: DEFAULT_REMINDERS,
  tourSeen: true,
  ...overrides,
});
const sevenDaysFrom = (start) => Array.from({ length: 7 }, (_, offset) => {
  const d = new Date(`${start}T12:00:00`);
  d.setDate(d.getDate() + offset);
  return {
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    available: true, minutes: 180,
  };
});

const WEEK = { start: '2026-10-05', end: '2026-10-11' };

test('the dashboard reports on the same seven days the window covers', () => {
  const data = baseData({ availability: sevenDaysFrom('2026-10-05') });

  assert.deepEqual(dashboardWeek(data, '2026-10-06'), WEEK);
});

test('a stale window rolls forward and the dashboard follows it', () => {
  const data = baseData({ availability: sevenDaysFrom('2026-09-21') });

  assert.deepEqual(dashboardWeek(data, '2026-10-07'), { start: '2026-10-07', end: '2026-10-13' });
});

test('with nothing set up at all the dashboard still starts on today', () => {
  const data = baseData({ availability: [] });

  assert.deepEqual(dashboardWeek(data, '2026-10-02'), { start: '2026-10-02', end: '2026-10-08' });
});

test('finishing today is counted, rather than falling outside the range', () => {
  // The bug this guards: the window used to start on the *next* Monday, so a check-in made
  // today sat outside the dashboard's range and the counter stayed at zero.
  const today = '2026-10-02';
  const data = baseData({
    availability: sevenDaysFrom(today),
    acceptedPlan: { days: [plannedDay({ date: today, projectId: 'p1' })], risks: [] },
    checkIns: { [`${today}|p1`]: checkIn({ date: today, projectId: 'p1', status: 'Finished' }) },
  });

  const summary = weekSummary(data, dashboardWeek(data, today));

  assert.equal(summary.plannedCount, 1);
  assert.equal(summary.completedCount, 1, 'today counts as completed');
});

// --- planned and completed days ----------------------------------------------------

test('planned days are the days of this week that hold a project', () => {
  const data = baseData({
    acceptedPlan: {
      days: [
        plannedDay({ date: '2026-10-05', projectId: 'p1' }),
        plannedDay({ date: '2026-10-06', projectId: null }),
        plannedDay({ date: '2026-10-09', projectId: 'p2' }),
        plannedDay({ date: '2026-10-12', projectId: 'p1' }),
      ],
      risks: [],
    },
  });

  const summary = weekSummary(data, WEEK);

  assert.equal(summary.plannedCount, 2);
  assert.deepEqual(summary.plannedDays.map((day) => day.date), ['2026-10-05', '2026-10-09']);
});

test('only a Finished check-in counts as a completed focus day', () => {
  const data = baseData({
    checkIns: {
      '2026-10-05|p1': checkIn({ date: '2026-10-05', status: 'Finished' }),
      '2026-10-06|p1': checkIn({ date: '2026-10-06', status: 'Partly finished' }),
      '2026-10-07|p1': checkIn({ date: '2026-10-07', status: 'Stuck' }),
      '2026-10-08|p1': checkIn({ date: '2026-10-08', status: "Didn't start" }),
    },
  });

  const summary = weekSummary(data, WEEK);

  assert.equal(summary.completedCount, 1, 'only Finished counts');
  assert.equal(summary.partlyCount, 1);
  assert.equal(summary.checkedInCount, 4);
});

test('check-ins outside the week are left out of it', () => {
  const data = baseData({
    checkIns: {
      '2026-09-30|p1': checkIn({ date: '2026-09-30', status: 'Finished' }),
      '2026-10-12|p1': checkIn({ date: '2026-10-12', status: 'Finished' }),
    },
  });

  const summary = weekSummary(data, WEEK);

  assert.equal(summary.completedCount, 0);
  assert.equal(summary.checkedInCount, 0);
});

test('an empty week counts zero rather than throwing', () => {
  const summary = weekSummary(baseData(), WEEK);

  assert.equal(summary.plannedCount, 0);
  assert.equal(summary.completedCount, 0);
  assert.deepEqual(summary.plannedDays, []);
});

// --- open work ---------------------------------------------------------------------

test('open work is the sessions no day of the plan is holding', () => {
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 3 }), entry({ id: 'p2', remainingSessions: 1 })],
    acceptedPlan: { days: [plannedDay({ date: '2026-10-05', projectId: 'p1' })], risks: [] },
  });

  const summary = weekSummary(data, WEEK);

  assert.deepEqual(summary.openWork.map((item) => ({ id: item.id, openSessions: item.openSessions })), [
    { id: 'p1', openSessions: 2 },
    { id: 'p2', openSessions: 1 },
  ]);
});

test('work that is fully placed is not listed as open', () => {
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 1 })],
    acceptedPlan: { days: [plannedDay({ date: '2026-10-05', projectId: 'p1' })], risks: [] },
  });

  assert.deepEqual(weekSummary(data, WEEK).openWork, []);
});

test('notes and ideas are never open work', () => {
  const data = baseData({
    entries: [entry({ id: 'note', parentId: 'p1' }), entry({ id: 'idea', kind: 'Idea' })],
  });

  assert.deepEqual(weekSummary(data, WEEK).openWork, []);
});

// --- deadlines and risks -----------------------------------------------------------

test('upcoming deadlines are listed soonest first and past ones are dropped', () => {
  const data = baseData({
    entries: [
      entry({ id: 'later', title: 'Later', deadline: '2026-10-20' }),
      entry({ id: 'sooner', title: 'Sooner', deadline: '2026-10-09' }),
      entry({ id: 'past', title: 'Past', deadline: '2026-09-01' }),
    ],
  });

  const summary = weekSummary(data, WEEK);

  assert.deepEqual(summary.upcomingDeadlines.map((item) => item.id), ['sooner', 'later']);
});

test('risks are the ones the accepted plan already carries', () => {
  // Reused rather than recomputed, so this screen cannot disagree with the Plan screen.
  const risk = { projectId: 'p1', title: 'Project one', unplannedSessions: 2, message: 'Two days do not fit.' };
  const data = baseData({ acceptedPlan: { days: [plannedDay({ date: '2026-10-05', projectId: 'p1' })], risks: [risk] } });

  assert.deepEqual(weekSummary(data, WEEK).risks, [risk]);
});

test('a week with no accepted plan has no risks rather than throwing', () => {
  assert.deepEqual(weekSummary(baseData(), WEEK).risks, []);
});
