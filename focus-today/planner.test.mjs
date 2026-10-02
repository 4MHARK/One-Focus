import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftPlan, planChanges, resolveProjectReference } from './planner.ts';

test('a saved plan day with an unknown project ID is represented as missing', () => {
  const result = resolveProjectReference([], 'deleted-project-id');
  assert.deepEqual(result, { kind: 'missing', projectId: 'deleted-project-id' });
});

test('draft planning retains an unknown project assignment without blocking valid work', () => {
  const availability = [
    { date: '2026-10-05', available: true, minutes: 180 },
    { date: '2026-10-06', available: true, minutes: 180 },
  ];
  const preserved = [{
    ...availability[0], projectId: 'old-project-id', reason: 'Saved before project was removed.', locked: false, edited: false,
  }];
  const draft = createDraftPlan([{
    id: 'current-project', title: 'Current project', appName: 'Example app', outcome: 'Make progress', remainingSessions: 1, priority: 'normal',
  }], availability, preserved);

  assert.equal(draft.days[0].projectId, 'old-project-id');
  assert.equal(resolveProjectReference([], draft.days[0].projectId).kind, 'missing');
  assert.equal(draft.days[1].projectId, 'current-project');
});

test('empty plan days remain open', () => {
  assert.deepEqual(resolveProjectReference([], null), { kind: 'open' });
});

test('an older malformed project reference is reported safely', () => {
  assert.deepEqual(resolveProjectReference([], 42), { kind: 'missing', projectId: '42' });
});

// Allocation order: earliest deadline first, priority breaking ties. Undated work
// is planned last, however urgent it claims to be.
const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
  .map((date) => ({ date, available: true, minutes: 180 }));
const project = (overrides = {}) => ({
  id: 'p', title: 'P', appName: 'Example', outcome: 'Make progress',
  remainingSessions: 1, priority: 'normal', ...overrides,
});
const datesFor = (plan, id) => plan.days.filter((day) => day.projectId === id).map((day) => day.date);

test('an earlier deadline takes the first day even against a more urgent undated project', () => {
  const plan = createDraftPlan([
    project({ id: 'undated-urgent', remainingSessions: 4, priority: 'urgent' }),
    project({ id: 'due-tomorrow', deadline: '2026-10-06', remainingSessions: 1 }),
  ], WEEK);

  assert.equal(plan.days[0].projectId, 'due-tomorrow');
  assert.deepEqual(plan.risks, []);
});

test('a project due mid-week is planned on days at or before its deadline', () => {
  const plan = createDraftPlan([
    project({ id: 'undated', remainingSessions: 3, priority: 'urgent' }),
    project({ id: 'due-wed', deadline: '2026-10-07', remainingSessions: 2 }),
  ], WEEK);

  assert.deepEqual(datesFor(plan, 'due-wed'), ['2026-10-05', '2026-10-06']);
  assert.deepEqual(plan.risks, []);
});

test('dated work is planned before undated work however urgent the undated work is', () => {
  const plan = createDraftPlan([
    project({ id: 'undated-urgent', priority: 'urgent' }),
    project({ id: 'dated-low', deadline: '2026-10-09', priority: 'low' }),
  ], WEEK);

  assert.equal(plan.days[0].projectId, 'dated-low');
  assert.equal(plan.days[1].projectId, 'undated-urgent');
});

test('priority breaks a tie between projects sharing a deadline', () => {
  const plan = createDraftPlan([
    project({ id: 'normal-same-day', deadline: '2026-10-07', priority: 'normal' }),
    project({ id: 'high-same-day', deadline: '2026-10-07', priority: 'high' }),
  ], WEEK);

  assert.equal(plan.days[0].projectId, 'high-same-day');
  assert.equal(plan.days[1].projectId, 'normal-same-day');
});

test('priority still orders undated work when no deadline distinguishes it', () => {
  const plan = createDraftPlan([
    project({ id: 'low-undated', priority: 'low' }),
    project({ id: 'urgent-undated', priority: 'urgent' }),
  ], WEEK);

  assert.equal(plan.days[0].projectId, 'urgent-undated');
  assert.equal(plan.days[1].projectId, 'low-undated');
});

test('work that cannot fit the window is still reported as a risk', () => {
  const plan = createDraftPlan([project({ id: 'seven', remainingSessions: 7 })], WEEK);

  assert.equal(datesFor(plan, 'seven').length, 5);
  assert.equal(plan.risks.length, 1);
  assert.equal(plan.risks[0].unplannedSessions, 2);
  assert.match(plan.risks[0].message, /2 focus days do not fit in the available days\./);
});

test('a fractional estimate is floored once, not reported as a part-session left over', () => {
  const plan = createDraftPlan([project({ id: 'fractional', remainingSessions: 2.5 })], WEEK);

  assert.equal(datesFor(plan, 'fractional').length, 2);
  assert.deepEqual(plan.risks, []);
});

// Comparing a proposed plan against the current one is what lets a change be explained as
// trade-offs before it is accepted.
const day = (date, projectId, overrides = {}) => ({
  date, available: true, minutes: 180, projectId, reason: '', locked: false, edited: false, ...overrides,
});

test('a plan compared against itself shows no changes', () => {
  const plan = [day('2026-10-05', 'a'), day('2026-10-06', 'b')];

  assert.deepEqual(planChanges(plan, plan), []);
});

test('a project moving to another day is reported on both days', () => {
  const before = [day('2026-10-05', 'a'), day('2026-10-06', null)];
  const after = [day('2026-10-05', null), day('2026-10-06', 'a')];

  assert.deepEqual(planChanges(before, after), [
    { date: '2026-10-05', fromProjectId: 'a', toProjectId: null },
    { date: '2026-10-06', fromProjectId: null, toProjectId: 'a' },
  ]);
});

test('a day dropped from the plan is reported as a change, not silently lost', () => {
  const before = [day('2026-10-05', 'a'), day('2026-10-06', 'b')];
  const after = [day('2026-10-05', 'a')];

  assert.deepEqual(planChanges(before, after), [{ date: '2026-10-06', fromProjectId: 'b', toProjectId: null }]);
});

test('a change of reason alone is not a change of plan', () => {
  const before = [day('2026-10-05', 'a', { reason: 'Because.' })];
  const after = [day('2026-10-05', 'a', { reason: 'A different explanation.' })];

  assert.deepEqual(planChanges(before, after), []);
});
