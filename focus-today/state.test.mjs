import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectReference } from './planner.ts';
import {
  acceptPlan, addEntry, candidatesForDays, checkInsInRange, chooseTodayProject, clearProjectFromDays,
  createInitialData, completeTodayAction, continueToday, finishToday, finishTour, freshWindow, getCheckIn,
  getTodayActionProgress, parseBackup, parseStoredState, plannerProject, removeEntry, replaceData,
  replanOptionsFor, replanProposal, saveCheckIn, saveTodayAction, serializeBackup, setReminders,
  shouldPersist, statusSpendsSession, toAppData, updateEntry, updatePlanDay, validateAppData,
} from './state.ts';
import { DEFAULT_REMINDERS } from './reminders.ts';

// --- fixtures ----------------------------------------------------------------------

const entry = (overrides = {}) => ({
  id: 'p1', title: 'Project one', appName: 'Example', kind: 'Coding', workModes: ['Planning'],
  description: '', outcome: 'Outcome', todayGoal: '', firstStep: '', todayReason: '',
  done: '', remaining: '', blocker: '', deadline: '', remainingSessions: 2, priority: 'normal',
  state: 'inbox', ...overrides,
});
const plannedDay = (overrides = {}) => ({
  date: '2026-10-05', available: true, minutes: 180, projectId: null, reason: '', locked: false, edited: false, ...overrides,
});
const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07'].map((date) => ({ date, available: true, minutes: 180 }));
const checkIn = (overrides = {}) => ({
  date: '2026-10-05', projectId: 'p1', status: 'Finished',
  accomplished: '', remaining: '', blocker: '', savedAt: '2026-10-05T20:00:00.000Z', ...overrides,
});
const baseData = (overrides = {}) => ({
  entries: [entry(), entry({ id: 'p2', title: 'Project two', state: 'planned' })],
  checkIns: {},
  legacyCheckIn: null,
  todayProjectId: 'p1',
  availability: WEEK,
  selectedProjectIds: ['p1'],
  acceptedPlan: null,
  todayActionProgress: {},
  reminders: DEFAULT_REMINDERS,
  tourSeen: true,
  ...overrides,
});

// --- reading what was written ------------------------------------------------------
// Hydration and backup restore both go through validateAppData, so a row the app wrote is
// always one it can read back, and a row it cannot fully read is refused.

test('a stored row this app wrote can be read back unchanged', () => {
  const data = baseData();
  const result = parseStoredState(JSON.stringify(data));

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, data);
});

test('older saved data without first-action progress loads without being reset', () => {
  const oldData = baseData();
  delete oldData.todayActionProgress;

  const result = parseStoredState(JSON.stringify(oldData));

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.todayActionProgress, {});
  assert.equal(result.data.entries[0].id, 'p1');
});

test('unreadable stored text is refused rather than treated as no saved data', () => {
  const result = parseStoredState('{ this is not json');

  assert.equal(result.ok, false);
  assert.match(result.reason, /not valid JSON/);
});

test('a saved entry missing its work modes is refused instead of reaching a screen', () => {
  const data = baseData();
  delete data.entries[0].workModes;

  const result = parseStoredState(JSON.stringify(data));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'One or more saved projects are incomplete.');
});

test('a saved entry with no first step is refused instead of crashing the Today screen', () => {
  const data = baseData();
  delete data.entries[0].firstStep;

  const result = parseStoredState(JSON.stringify(data));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'One or more saved projects are incomplete.');
});

test('a backup carrying a project with no first step is refused', () => {
  const data = baseData();
  delete data.entries[0].firstStep;
  const file = JSON.parse(serializeBackup(data, 'now'));

  const result = parseBackup(JSON.stringify(file));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'This backup is not valid or uses an unsupported version. Your saved data was not changed.');
});

test('a saved entry with an unrecognised kind or state is refused', () => {
  for (const broken of [{ kind: 'Nonsense' }, { state: 'archived' }, { title: 42 }]) {
    const data = baseData();
    Object.assign(data.entries[0], broken);
    assert.equal(parseStoredState(JSON.stringify(data)).ok, false, `expected refusal for ${JSON.stringify(broken)}`);
  }
});

test('a saved check-in or plan with missing fields is refused', () => {
  const missingText = baseData({ checkIns: { '2026-10-05|p1': { date: '2026-10-05', projectId: 'p1', status: 'Finished', accomplished: '', remaining: '', blocker: '' } } });
  assert.equal(parseStoredState(JSON.stringify(missingText)).ok, false);

  const unknownStatus = baseData({ checkIns: { '2026-10-05|p1': checkIn({ status: 'Nearly done' }) } });
  assert.equal(parseStoredState(JSON.stringify(unknownStatus)).ok, false);

  const noDate = baseData({ checkIns: { '2026-10-05|p1': checkIn({ date: undefined }) } });
  assert.equal(parseStoredState(JSON.stringify(noDate)).ok, false);

  const badPlan = baseData({ acceptedPlan: { days: [{ date: '2026-10-05' }], risks: [] } });
  assert.equal(parseStoredState(JSON.stringify(badPlan)).ok, false);

  const badRisk = baseData({ acceptedPlan: { days: [], risks: [{ projectId: 'p1', title: 'T' }] } });
  assert.equal(parseStoredState(JSON.stringify(badRisk)).ok, false);
});

test('a non-object payload is refused', () => {
  for (const value of [null, 42, 'text', []]) {
    assert.equal(validateAppData(value).ok, false, `expected refusal for ${JSON.stringify(value)}`);
  }
});

test('writing is blocked until a load has finished without a problem', () => {
  assert.equal(shouldPersist({ hydrated: false, loadProblem: null }), false, 'not yet hydrated');
  assert.equal(shouldPersist({ hydrated: true, loadProblem: 'Could not read.' }), false, 'load failed');
  assert.equal(shouldPersist({ hydrated: true, loadProblem: null }), true, 'healthy load');
});

// --- what a backup contains --------------------------------------------------------

test('the exported shape covers every field the app persists', () => {
  // A hand-built export object dropped new fields silently once already. Comparing against a
  // fully-populated AppData fixture means adding a field cannot quietly miss the backup.
  const full = baseData();
  const file = JSON.parse(serializeBackup(toAppData(full), '2026-10-02T00:00:00.000Z'));

  assert.deepEqual(Object.keys(file.data).sort(), Object.keys(full).sort());
});

test('a backup round-trips check-ins, the legacy record, and reminders', () => {
  const data = baseData({
    checkIns: { '2026-10-05|p1': checkIn({ status: 'Stuck' }) },
    legacyCheckIn: { status: 'Finished', accomplished: 'a', remaining: 'b', blocker: 'c', savedAt: '2026-10-01T21:00:00.000Z' },
    reminders: { morning: { enabled: false, hour: 6, minute: 45 }, evening: { enabled: true, hour: 21, minute: 15 } },
  });

  const restored = parseBackup(serializeBackup(data, 'now'));

  assert.equal(restored.ok, true);
  assert.deepEqual(restored.data, data);
});

// --- backups -----------------------------------------------------------------------

test('a backup round-trips through export and restore', () => {
  const data = baseData();
  const text = serializeBackup(data, '2026-10-02T00:00:00.000Z');

  const file = JSON.parse(text);
  assert.equal(file.format, 'one-thing-backup');
  assert.equal(file.version, 1);
  assert.deepEqual(parseBackup(text).data, data);
});

test('first actions can be completed, continued, stopped, and restored without completing the focus project', () => {
  const date = '2026-10-02';
  const data = baseData({
    entries: [entry({ firstStep: 'Read the campus assignment notes.', nextStep: 'Write down the campus assignment options.' }), entry({ id: 'p2', title: 'Project two', state: 'planned' })],
    acceptedPlan: { days: [plannedDay({ projectId: 'p1' })], risks: [] },
  });

  assert.equal(getTodayActionProgress(data, 'p1', date).currentAction, 'Read the campus assignment notes.');
  const afterFirst = completeTodayAction(data, 'p1', date);
  let progress = getTodayActionProgress(afterFirst, 'p1', date);
  assert.deepEqual(progress.completedActions, ['Read the campus assignment notes.']);
  assert.equal(progress.currentAction, 'Write down the campus assignment options.');
  assert.equal(afterFirst.todayProjectId, 'p1');
  assert.equal(afterFirst.acceptedPlan.days[0].projectId, 'p1');
  assert.equal(afterFirst.entries[0].state, 'inbox', 'action completion does not mark the project complete');

  assert.equal(progress.currentAction, 'Write down the campus assignment options.', 'an explicitly supplied next action appears after the first is done');
  const pausedWithNext = finishToday(afterFirst, 'p1', date);
  assert.equal(getTodayActionProgress(pausedWithNext, 'p1', date).doneForToday, true);
  assert.equal(getTodayActionProgress(pausedWithNext, 'p1', date).currentAction, 'Write down the campus assignment options.', 'stopping for today keeps the supplied action for later');
  assert.equal(getTodayActionProgress(continueToday(pausedWithNext, 'p1', date), 'p1', date).currentAction, 'Write down the campus assignment options.');
  const afterSecond = completeTodayAction(afterFirst, 'p1', date);
  const withNext = saveTodayAction(afterSecond, 'p1', 'Review the notes before choosing.', date);
  assert.equal(getTodayActionProgress(withNext, 'p1', date).currentAction, 'Review the notes before choosing.');
  const afterThird = completeTodayAction(withNext, 'p1', date);
  const stopped = finishToday(afterThird, 'p1', date);
  progress = getTodayActionProgress(stopped, 'p1', date);
  assert.equal(progress.doneForToday, true);
  assert.deepEqual(progress.completedActions, ['Read the campus assignment notes.', 'Write down the campus assignment options.', 'Review the notes before choosing.']);
  assert.equal(stopped.todayProjectId, 'p1');
  assert.equal(stopped.acceptedPlan.days[0].projectId, 'p1');

  const restored = parseStoredState(JSON.stringify(stopped));
  assert.equal(restored.ok, true);
  assert.deepEqual(getTodayActionProgress(restored.data, 'p1', date), progress);
  assert.equal(getTodayActionProgress(continueToday(restored.data, 'p1', date), 'p1', date).doneForToday, false);
  assert.equal(getTodayActionProgress(restored.data, 'p1', '2026-10-03').currentAction, 'Read the campus assignment notes.', 'the next date starts a separate action flow');

  const restoredBackup = parseBackup(serializeBackup(stopped, '2026-10-02T21:00:00.000Z'));
  assert.equal(restoredBackup.ok, true);
  assert.deepEqual(getTodayActionProgress(restoredBackup.data, 'p1', date), progress);
});

test('no action is invented when the project has no supplied first step', () => {
  const data = baseData({ entries: [entry({ firstStep: '' })] });
  assert.equal(getTodayActionProgress(data, 'p1', '2026-10-02').currentAction, '');
  assert.equal(completeTodayAction(data, 'p1', '2026-10-02'), data);
  const entered = saveTodayAction(data, 'p1', 'Read my project notes first.', '2026-10-02');
  assert.equal(getTodayActionProgress(entered, 'p1', '2026-10-02').currentAction, 'Read my project notes first.');
  assert.deepEqual(getTodayActionProgress(completeTodayAction(entered, 'p1', '2026-10-02'), 'p1', '2026-10-02').completedActions, ['Read my project notes first.']);
});

test('a project with no first step reads as having no action rather than throwing', () => {
  // Defence in depth: the validator refuses such an entry, but nothing that reaches this
  // function may throw, because the Today screen calls it on every render.
  const { firstStep, ...noFirstStep } = entry();
  const data = baseData({ entries: [noFirstStep] });

  assert.equal(getTodayActionProgress(data, 'p1', '2026-10-02').currentAction, '');
  assert.equal(completeTodayAction(data, 'p1', '2026-10-02'), data, 'there is nothing to complete');
});

test('a backup from another format or a later version is refused', () => {
  const data = baseData();
  const wrongFormat = { ...JSON.parse(serializeBackup(data, 'now')), format: 'other-app' };
  const wrongVersion = { ...JSON.parse(serializeBackup(data, 'now')), version: 2 };

  for (const file of [wrongFormat, wrongVersion]) {
    const result = parseBackup(JSON.stringify(file));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'This backup is not valid or uses an unsupported version. Your saved data was not changed.');
  }
});

test('unreadable pasted text says so in plain language', () => {
  const result = parseBackup('definitely not json');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'I could not read that JSON. Your saved data was not changed.');
});

test('a well-formed backup carrying broken data is refused', () => {
  const data = baseData();
  const file = JSON.parse(serializeBackup(data, 'now'));
  delete file.data.entries[0].workModes;

  assert.equal(parseBackup(JSON.stringify(file)).ok, false);
});

// --- transitions -------------------------------------------------------------------

test('addEntry keeps the id it is given so a drafted day still resolves to a real project', () => {
  const { id, ...withoutId } = entry({ id: 'sample-thing', title: 'Sample thing' });
  const next = addEntry(baseData(), withoutId, 'urgent-lab');

  assert.equal(next.entries[0].id, 'urgent-lab');
  assert.equal(resolveProjectReference(next.entries, 'urgent-lab').kind, 'assigned');
});

test('a generated id would leave the drafted day pointing at nothing', () => {
  // The overload example drafts a day for 'urgent-lab'. If addEntry renamed that entry,
  // the day would render as a missing project — this is the bug the id argument prevents.
  const { id, ...withoutId } = entry({ id: 'sample-thing', title: 'Sample thing' });
  const renamed = addEntry(baseData(), withoutId, 'capture-123');

  assert.equal(resolveProjectReference(renamed.entries, 'urgent-lab').kind, 'missing');
});

test('addEntry puts the new item first and leaves the rest alone', () => {
  const data = baseData();
  const next = addEntry(data, { ...entry(), title: 'Fresh capture' }, 'new-1');

  assert.equal(next.entries.length, 3);
  assert.equal(next.entries[0].id, 'new-1');
  assert.equal(next.entries[1].id, 'p1');
});

test('updateEntry replaces only the matching item', () => {
  const next = updateEntry(baseData(), entry({ id: 'p2', title: 'Renamed' }));

  assert.equal(next.entries.find((item) => item.id === 'p2').title, 'Renamed');
  assert.equal(next.entries.find((item) => item.id === 'p1').title, 'Project one');
});

test('choosing today marks that project planned and no longer erases a saved check-in', () => {
  // The single global check-in used to be cleared here. Now that check-ins are dated, switching
  // focus must leave earlier records intact.
  const data = baseData({ checkIns: { '2026-10-04|p2': checkIn({ date: '2026-10-04', projectId: 'p2', status: 'Stuck' }) } });
  const next = chooseTodayProject(data, 'p1');

  assert.equal(next.todayProjectId, 'p1');
  assert.equal(next.entries.find((item) => item.id === 'p1').state, 'planned');
  assert.deepEqual(next.checkIns, data.checkIns);
});

test('accepting a plan places its projects and returns the others to the Inbox', () => {
  const plan = { days: [plannedDay({ projectId: 'p1' })], risks: [] };
  const next = acceptPlan(baseData(), plan);

  assert.equal(next.acceptedPlan, plan);
  assert.equal(next.entries.find((item) => item.id === 'p1').state, 'planned');
  assert.equal(next.entries.find((item) => item.id === 'p2').state, 'inbox');
});

test('accepting a plan leaves notes and ideas where they are', () => {
  const data = baseData({
    entries: [entry({ id: 'p1' }), entry({ id: 'note', parentId: 'p1', state: 'planned' }), entry({ id: 'idea', kind: 'Idea', state: 'planned' })],
  });
  const next = acceptPlan(data, { days: [plannedDay({ projectId: 'p1' })], risks: [] });

  assert.equal(next.entries.find((item) => item.id === 'note').state, 'planned');
  assert.equal(next.entries.find((item) => item.id === 'idea').state, 'planned');
});

test('editing a day of the accepted plan re-scores the risks', () => {
  const threeSessions = entry({ id: 'p1', remainingSessions: 3 });
  const data = baseData({
    entries: [threeSessions],
    selectedProjectIds: ['p1'],
    acceptedPlan: { days: [plannedDay({ projectId: 'p1' }), plannedDay({ date: '2026-10-06' })], risks: [] },
  });

  const next = updatePlanDay(data, plannedDay({ date: '2026-10-06', locked: true, edited: true }));

  assert.equal(next.acceptedPlan.risks.length, 1);
  assert.equal(next.acceptedPlan.risks[0].unplannedSessions, 2);
});

test('a day change for a date outside the plan is ignored instead of throwing', () => {
  const data = baseData({ acceptedPlan: { days: [plannedDay({ projectId: 'p1' })], risks: [] } });
  const stranger = plannedDay({ date: '2099-01-01', projectId: 'p1' });

  assert.equal(updatePlanDay(data, stranger), data);
});

test('a day change with no accepted plan is ignored', () => {
  const data = baseData();

  assert.equal(updatePlanDay(data, plannedDay({ projectId: 'p1' })), data);
});

test('re-scoring covers the selected and already-placed projects only', () => {
  const data = baseData({
    entries: [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })],
    selectedProjectIds: ['a'],
  });

  const ids = candidatesForDays(data.entries, data.selectedProjectIds, [plannedDay({ projectId: 'b' })])
    .map((project) => project.id).sort();

  assert.deepEqual(ids, ['a', 'b']);
});

test('restoring replaces every field', () => {
  const incoming = baseData({ todayProjectId: 'p2', selectedProjectIds: ['p2'] });

  assert.equal(replaceData(baseData(), incoming), incoming);
});

test('transitions do not mutate the state they are given', () => {
  const data = baseData({ checkIns: { '2026-10-05|p1': checkIn({ status: 'Stuck' }) } });
  const before = JSON.stringify(data);

  addEntry(data, { ...entry(), title: 'New' }, 'new-1');
  updateEntry(data, entry({ id: 'p1', title: 'Renamed' }));
  chooseTodayProject(data, 'p2');
  saveCheckIn(data, checkIn({ date: '2026-10-06', status: 'Partly finished' }));
  acceptPlan(data, { days: [plannedDay({ projectId: 'p2' })], risks: [] });

  assert.equal(JSON.stringify(data), before);
});

// --- deleting a project ------------------------------------------------------------

test('removing a project takes it out of the list and the draft selection', () => {
  const next = removeEntry(baseData({ selectedProjectIds: ['p1', 'p2'] }), 'p1');

  assert.deepEqual(next.entries.map((item) => item.id), ['p2']);
  assert.deepEqual(next.selectedProjectIds, ['p2']);
});

test('removing the overload sample leaves nothing pointing at it', () => {
  // The overload example adds 'urgent-lab' and drafts a day for it. Deleting the project has to
  // release that day too, or the plan keeps showing a project that is no longer in the list.
  const { id, ...withoutId } = entry({ id: 'sample-thing', title: 'Sample thing' });
  const added = addEntry(baseData({ selectedProjectIds: ['urgent-lab'] }), withoutId, 'urgent-lab');
  const planned = { ...added, acceptedPlan: { days: [plannedDay({ projectId: 'urgent-lab' })], risks: [] } };

  const next = removeEntry(planned, 'urgent-lab');

  assert.equal(next.entries.some((item) => item.id === 'urgent-lab'), false);
  assert.deepEqual(next.selectedProjectIds, []);
  assert.equal(next.acceptedPlan.days[0].projectId, null);
  assert.equal(next.acceptedPlan.days[0].reason, '');
  assert.equal(next.acceptedPlan.days.some((day) => day.projectId === 'urgent-lab'), false);
});

test('removing a project releases only the days it was holding', () => {
  const data = baseData({
    entries: [entry({ id: 'p1' }), entry({ id: 'p2' })],
    acceptedPlan: { days: [plannedDay({ projectId: 'p1' }), plannedDay({ date: '2026-10-06', projectId: 'p2', reason: 'Because.' })], risks: [] },
  });

  const next = removeEntry(data, 'p1');

  assert.equal(next.acceptedPlan.days[0].projectId, null);
  assert.equal(next.acceptedPlan.days[1].projectId, 'p2');
  assert.equal(next.acceptedPlan.days[1].reason, 'Because.');
});

test('a released day stays open instead of being given to waiting work', () => {
  const data = baseData({
    entries: [entry({ id: 'p1' }), entry({ id: 'p2', remainingSessions: 1 })],
    selectedProjectIds: ['p1', 'p2'],
    acceptedPlan: { days: [plannedDay({ projectId: 'p1' })], risks: [] },
  });

  const next = removeEntry(data, 'p1');

  assert.equal(next.acceptedPlan.days[0].projectId, null, 'p2 waits rather than being moved in');
});

test('removing today’s focus hands the focus to the next project', () => {
  assert.equal(removeEntry(baseData({ todayProjectId: 'p1' }), 'p1').todayProjectId, 'p2');
});

test('removing a project that is not today’s focus leaves the focus alone', () => {
  assert.equal(removeEntry(baseData({ todayProjectId: 'p1' }), 'p2').todayProjectId, 'p1');
});

test('removing the last project clears the focus rather than keeping a dead id', () => {
  const data = baseData({ entries: [entry({ id: 'only' })], todayProjectId: 'only' });

  assert.equal(removeEntry(data, 'only').todayProjectId, '');
});

test('removing an unknown id changes nothing', () => {
  const data = baseData();
  const next = removeEntry(data, 'nobody');

  assert.deepEqual(next.entries, data.entries);
  assert.deepEqual(next.selectedProjectIds, data.selectedProjectIds);
  assert.equal(next.acceptedPlan, null);
});

test('removing a project does not mutate the state it is given', () => {
  const data = baseData({ acceptedPlan: { days: [plannedDay({ projectId: 'p1' })], risks: [] } });
  const before = JSON.stringify(data);

  removeEntry(data, 'p1');

  assert.equal(JSON.stringify(data), before);
});

test('removing a project also clears its action history', () => {
  const date = '2026-10-02';
  const worked = completeTodayAction(baseData({ entries: [entry({ firstStep: 'Read the notes.' })] }), 'p1', date);
  assert.deepEqual(Object.keys(worked.todayActionProgress), [`${date}|p1`]);

  const next = removeEntry(worked, 'p1');

  assert.deepEqual(next.todayActionProgress, {});
});

test('removing a project clears its history on every date and leaves other projects alone', () => {
  const data = baseData({
    todayActionProgress: {
      '2026-10-01|p1': { date: '2026-10-01', currentAction: 'An older step.', completedActions: ['Done earlier.'], doneForToday: true },
      '2026-10-02|p1': { date: '2026-10-02', currentAction: 'Today’s step.', completedActions: [], doneForToday: false },
      '2026-10-02|p2': { date: '2026-10-02', currentAction: 'Another project’s step.', completedActions: [], doneForToday: false },
    },
  });

  const next = removeEntry(data, 'p1');

  assert.deepEqual(Object.keys(next.todayActionProgress), ['2026-10-02|p2']);
});

test('a project re-added under the same id does not inherit its old actions', () => {
  // The overload example re-adds 'urgent-lab' under a fixed id, so a leftover history record
  // would come back to life the second time the button is pressed.
  const date = '2026-10-02';
  const worked = completeTodayAction(baseData({ entries: [entry({ id: 'temp', firstStep: 'Read the notes.' })] }), 'temp', date);
  assert.deepEqual(getTodayActionProgress(worked, 'temp', date).completedActions, ['Read the notes.']);

  const readded = addEntry(removeEntry(worked, 'temp'), entry({ id: 'temp', firstStep: 'Read the notes.' }), 'temp');

  assert.deepEqual(getTodayActionProgress(readded, 'temp', date).completedActions, [], 'the old history stays gone');
  assert.equal(getTodayActionProgress(readded, 'temp', date).currentAction, 'Read the notes.', 'and the new flow starts from the first step');
});

test('releasing days leaves the day itself, and its lock, in place', () => {
  const days = [plannedDay({ projectId: 'a', reason: 'Because.' }), plannedDay({ date: '2026-10-06', projectId: 'b', locked: true })];

  const next = clearProjectFromDays(days, 'a');

  assert.equal(next[0].projectId, null);
  assert.equal(next[0].reason, '');
  assert.equal(next[1].projectId, 'b');
  assert.equal(next[1].locked, true);
});

// --- dated check-ins ---------------------------------------------------------------

test('a check-in is stored against its own day and project', () => {
  const data = saveCheckIn(baseData(), checkIn({ date: '2026-10-05', projectId: 'p1', status: 'Finished' }));
  const other = saveCheckIn(data, checkIn({ date: '2026-10-06', projectId: 'p1', status: 'Stuck' }));

  assert.equal(getCheckIn(other, 'p1', '2026-10-05').status, 'Finished');
  assert.equal(getCheckIn(other, 'p1', '2026-10-06').status, 'Stuck');
  assert.equal(getCheckIn(other, 'p2', '2026-10-05'), null);
});

test('a second check-in for the same day and project replaces the first', () => {
  const first = saveCheckIn(baseData(), checkIn({ status: 'Partly finished' }));
  const second = saveCheckIn(first, checkIn({ status: 'Finished' }));

  assert.equal(getCheckIn(second, 'p1', '2026-10-05').status, 'Finished');
  assert.equal(Object.keys(second.checkIns).length, 1);
});

test('check-ins in a range come back oldest first and exclude other days', () => {
  const data = saveCheckIn(
    saveCheckIn(saveCheckIn(baseData(), checkIn({ date: '2026-10-07' })), checkIn({ date: '2026-10-05' })),
    checkIn({ date: '2026-09-30' }),
  );

  assert.deepEqual(checkInsInRange(data, '2026-10-05', '2026-10-07').map((item) => item.date), ['2026-10-05', '2026-10-07']);
  assert.deepEqual(checkInsInRange(data, '2026-10-06', '2026-10-06'), []);
});

test('removing a project clears its check-ins as well as its actions', () => {
  const data = baseData({
    checkIns: {
      '2026-10-05|p1': checkIn({ date: '2026-10-05', projectId: 'p1' }),
      '2026-10-04|p1': checkIn({ date: '2026-10-04', projectId: 'p1' }),
      '2026-10-05|p2': checkIn({ date: '2026-10-05', projectId: 'p2' }),
    },
  });

  assert.deepEqual(Object.keys(removeEntry(data, 'p1').checkIns), ['2026-10-05|p2']);
});

// --- the first-run tour ------------------------------------------------------------

test('a row saved before the tour existed shows it once', () => {
  const data = baseData();
  delete data.tourSeen;

  const result = parseStoredState(JSON.stringify(data));

  assert.equal(result.ok, true);
  assert.equal(result.data.tourSeen, false, 'so an existing install is walked through once');
});

test('finishing the tour is remembered', () => {
  assert.equal(finishTour(baseData({ tourSeen: false })).tourSeen, true);
});

test('the tour flag survives an export and a restore', () => {
  const restored = parseBackup(serializeBackup(baseData({ tourSeen: true }), 'now'));

  assert.equal(restored.ok, true);
  assert.equal(restored.data.tourSeen, true);
});

// --- reminders ---------------------------------------------------------------------

test('starter data carries the default reminder times', () => {
  assert.deepEqual(createInitialData(new Date('2026-10-02T12:00:00')).reminders, DEFAULT_REMINDERS);
});

test('an impossible reminder time is clamped rather than stored', () => {
  const next = setReminders(baseData(), { morning: { enabled: true, hour: 99, minute: -5 }, evening: { enabled: false, hour: 20, minute: 0 } });

  assert.deepEqual(next.reminders.morning, { enabled: true, hour: 23, minute: 0 });
  assert.equal(next.reminders.evening.enabled, false);
});

test('saved reminders of the wrong shape are refused', () => {
  const data = baseData({ reminders: { morning: { enabled: 'yes', hour: 8, minute: 0 }, evening: { enabled: true, hour: 20, minute: 0 } } });

  assert.equal(parseStoredState(JSON.stringify(data)).ok, false);
});

test('saved data with no reminders yet loads with the defaults', () => {
  const data = baseData();
  delete data.reminders;

  const result = parseStoredState(JSON.stringify(data));

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.reminders, DEFAULT_REMINDERS);
});

// --- the old single check-in -------------------------------------------------------

test('data written before check-ins were dated keeps its check-in as a legacy record', () => {
  const data = baseData();
  delete data.checkIns;
  delete data.legacyCheckIn;
  data.checkIn = { status: 'Partly finished', accomplished: 'Some notes.', remaining: 'The rest.', blocker: '', savedAt: '2026-10-01T21:00:00.000Z' };

  const result = parseStoredState(JSON.stringify(data));

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.checkIns, {}, 'an undated record is not invented onto a day');
  assert.equal(result.data.legacyCheckIn.status, 'Partly finished');
  assert.equal(result.data.legacyCheckIn.accomplished, 'Some notes.');
});

test('a legacy check-in survives an export and a restore', () => {
  const data = baseData({ legacyCheckIn: { status: 'Stuck', accomplished: '', remaining: '', blocker: 'Waiting.', savedAt: '2026-10-01T21:00:00.000Z' } });

  const restored = parseBackup(serializeBackup(data, 'now'));

  assert.equal(restored.ok, true);
  assert.deepEqual(restored.data.legacyCheckIn, data.legacyCheckIn);
});

// --- replanning after a check-in ---------------------------------------------------

const planned = (date, projectId, overrides = {}) => plannedDay({ date, projectId, ...overrides });
const datesOf = (plan, id) => plan.days.filter((day) => day.projectId === id).map((day) => day.date);

test('there is nothing to propose without an accepted plan', () => {
  assert.equal(replanProposal(baseData(), { today: '2026-10-05' }), null);
});

test('rebuilding from unchanged inputs proposes nothing, which is why a spent session matters', () => {
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 2 })],
    selectedProjectIds: ['p1'],
    acceptedPlan: { days: [planned('2026-10-05', 'p1'), planned('2026-10-06', 'p1')], risks: [] },
  });

  assert.deepEqual(replanProposal(data, { today: '2026-10-05' }).changes, []);
});

test('a spent session is reported and frees the day it no longer needs', () => {
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 2 })],
    selectedProjectIds: ['p1'],
    acceptedPlan: { days: [planned('2026-10-05', 'p1'), planned('2026-10-06', 'p1')], risks: [] },
  });

  const proposal = replanProposal(data, { today: '2026-10-05', spentProjectId: 'p1' });

  assert.deepEqual(proposal.adjustments, [{ projectId: 'p1', title: 'Project one', from: 2, to: 1 }]);
  assert.deepEqual(proposal.changes, [{ date: '2026-10-06', fromTitle: 'Project one', toTitle: null }]);
  assert.deepEqual(datesOf(proposal.plan, 'p1'), ['2026-10-05']);
});

test('a proposal never moves a locked day', () => {
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 3 })],
    selectedProjectIds: ['p1'],
    acceptedPlan: { days: [planned('2026-10-05', 'p1'), planned('2026-10-06', 'p1', { locked: true })], risks: [] },
  });

  const proposal = replanProposal(data, { today: '2026-10-05' });

  assert.equal(proposal.plan.days.find((day) => day.date === '2026-10-06').projectId, 'p1');
});

test('a project already on the plan is still scored even when it is no longer selected', () => {
  // createDraftPlan freezes any day whose project is absent from the list it is given, and that
  // day then drops out of the risks too — frozen and invisible. The candidate set must include
  // what the plan already holds, or the remaining work silently stops being reported.
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 5 })],
    selectedProjectIds: [],
    acceptedPlan: { days: [planned('2026-10-05', 'p1')], risks: [] },
  });

  const proposal = replanProposal(data, { today: '2026-10-05' });

  assert.equal(datesOf(proposal.plan, 'p1').length, 3, 'it is planned across the open week, not frozen');
  assert.equal(proposal.plan.risks.length, 1, 'and its shortfall is still reported');
  assert.equal(proposal.plan.risks[0].projectId, 'p1');
  assert.equal(proposal.plan.risks[0].unplannedSessions, 2);
});

test('a window that has already passed is rolled forward to start today', () => {
  const past = ['2026-09-21', '2026-09-22'].map((date) => ({ date, available: true, minutes: 120 }));

  const rolled = freshWindow(past, '2026-10-07');

  assert.equal(rolled.length, 7);
  assert.equal(rolled[0].date, '2026-10-07', 'it starts on the day you are actually on');
  assert.equal(rolled[6].date, '2026-10-13');
  assert.equal(rolled[6].minutes, 120, 'the Monday pattern follows Monday, not position 0');
});

test('a window that still reaches today is left exactly as it is', () => {
  assert.equal(freshWindow(WEEK, '2026-10-06'), WEEK);
});

test('a proposal says when it had to move onto the current week', () => {
  const past = ['2026-09-21', '2026-09-22', '2026-09-23'].map((date) => ({ date, available: true, minutes: 180 }));
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 1 })],
    selectedProjectIds: ['p1'],
    availability: past,
    acceptedPlan: { days: [planned('2026-09-21', 'p1')], risks: [] },
  });

  const proposal = replanProposal(data, { today: '2026-10-07' });

  assert.equal(proposal.rolled, true);
  assert.equal(proposal.window[0].date, '2026-10-07', 'the rolled window starts today');
});

test('a proposal built on a week that still reaches today is not marked as rolled', () => {
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 1 })],
    selectedProjectIds: ['p1'],
    acceptedPlan: { days: [planned('2026-10-05', 'p1')], risks: [] },
  });

  assert.equal(replanProposal(data, { today: '2026-10-05' }).rolled, false);
});

test('a status counts as spending a session only when work actually happened', () => {
  assert.equal(statusSpendsSession('Finished'), true);
  assert.equal(statusSpendsSession('Partly finished'), true);
  assert.equal(statusSpendsSession('Stuck'), true);
  assert.equal(statusSpendsSession("Didn't start"), false);
});

test('a day the work did not happen on is treated as spent, so the work moves', () => {
  // Without this, "Didn't start" rebuilt from unchanged inputs and proposed nothing at all,
  // which made the panel look broken for one of the three statuses that should trigger it.
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 2 }), entry({ id: 'p2', remainingSessions: 1 })],
    selectedProjectIds: ['p1', 'p2'],
    acceptedPlan: { days: [planned('2026-10-05', 'p1'), planned('2026-10-06', 'p1')], risks: [] },
  });

  const proposal = replanProposal(data, replanOptionsFor("Didn't start", 'p1', '2026-10-05'));

  assert.equal(proposal.adjustments.length, 0, 'no session was spent, so the estimate stands');
  assert.equal(proposal.plan.days.find((day) => day.date === '2026-10-05').available, false, 'the missed day is gone');
  assert.equal(proposal.plan.days.find((day) => day.date === '2026-10-05').projectId, null);
  assert.ok(proposal.changes.length > 0, 'the remaining work is re-placed rather than left behind');
  assert.deepEqual(datesOf(proposal.plan, 'p1'), ['2026-10-06', '2026-10-07']);
});

test('finishing offers work to pull forward instead of applying it', () => {
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 2 }), entry({ id: 'p2', remainingSessions: 1 })],
    selectedProjectIds: ['p1', 'p2'],
    acceptedPlan: { days: [planned('2026-10-05', 'p1'), planned('2026-10-06', 'p1')], risks: [] },
  });

  const proposal = replanProposal(data, replanOptionsFor('Finished', 'p1', '2026-10-05'));

  assert.deepEqual(proposal.adjustments, [{ projectId: 'p1', title: 'Project one', from: 2, to: 1 }]);
  assert.deepEqual(datesOf(proposal.plan, 'p2'), ['2026-10-06'], 'the other project comes forward');
});

test('each status maps to the change it should propose', () => {
  assert.deepEqual(replanOptionsFor('Finished', 'p1', '2026-10-05'), { today: '2026-10-05', spentProjectId: 'p1' });
  assert.deepEqual(replanOptionsFor('Stuck', 'p1', '2026-10-05'), { today: '2026-10-05', spentProjectId: 'p1' });
  assert.deepEqual(replanOptionsFor("Didn't start", 'p1', '2026-10-05'), { today: '2026-10-05', spentDay: '2026-10-05' });
});

test('a proposal only marks the missed day as spent, not the rest of the window', () => {
  const data = baseData({
    entries: [entry({ id: 'p1', remainingSessions: 1 })],
    selectedProjectIds: ['p1'],
    acceptedPlan: { days: [planned('2026-10-05', 'p1')], risks: [] },
  });

  const proposal = replanProposal(data, replanOptionsFor("Didn't start", 'p1', '2026-10-05'));

  assert.deepEqual(proposal.window.map((day) => day.available), [false, true, true]);
  assert.equal(proposal.rolled, false, 'marking a day spent is not the same as rolling the week');
});

// --- entry to planner project ------------------------------------------------------

test('a fractional estimate is floored before it reaches the planner', () => {
  assert.equal(plannerProject(entry({ remainingSessions: 2.7 })).remainingSessions, 2);
});

test('a missing or unusable estimate falls back rather than scheduling nothing', () => {
  assert.equal(plannerProject(entry({ id: 'cs50p', remainingSessions: undefined })).remainingSessions, 1);
  assert.equal(plannerProject(entry({ id: 'cs50p', remainingSessions: 0 })).remainingSessions, 1);
  assert.equal(plannerProject(entry({ id: 'cs50p', remainingSessions: Number.NaN })).remainingSessions, 1);
});

test('a deadline reaches the planner only as a plain ISO date', () => {
  assert.equal(plannerProject(entry({ deadline: '2026-10-09' })).deadline, '2026-10-09');
  assert.equal(plannerProject(entry({ deadline: 'No deadline set' })).deadline, undefined);
  assert.equal(plannerProject(entry({ deadline: '' })).deadline, undefined);
});

test('an unrecognised priority falls back instead of throwing', () => {
  assert.equal(plannerProject(entry({ id: 'cs50p', priority: 'whenever' })).priority, 'normal');
  assert.equal(plannerProject(entry({ id: 'cs50p', priority: undefined })).priority, 'normal');
});

// --- starter data ------------------------------------------------------------------

test('starter data is reproducible from a reference date', () => {
  const friday = new Date('2026-10-02T12:00:00');
  const data = createInitialData(friday);

  assert.deepEqual(data, createInitialData(friday));
  assert.equal(data.availability[0].date, '2026-10-02', 'the window starts on the day you open the app');
  assert.deepEqual(data.entries, [], 'a new install starts empty');
  assert.equal(data.todayProjectId, '', 'and has no focus chosen yet');
  assert.deepEqual(data.selectedProjectIds, []);
});

test('starter data survives its own validator', () => {
  // Starter data is written on the first run, so it has to read back as valid.
  const starter = createInitialData(new Date('2026-10-02T12:00:00'));

  assert.equal(validateAppData(JSON.parse(JSON.stringify(starter))).ok, true);
});

test('a brand-new install survives its own validator', () => {
  // This is what gets written on first launch, so it has to read back as valid.
  const fresh = createInitialData(new Date('2026-10-02T12:00:00'));

  assert.equal(validateAppData(JSON.parse(JSON.stringify(fresh))).ok, true);
});

test('the first day of a new install is inside its own planning window', () => {
  // This is what makes a check-in on day one count: the window has to contain today.
  const fresh = createInitialData(new Date('2026-10-02T12:00:00'));

  assert.equal(fresh.availability[0].date, '2026-10-02');
  assert.equal(fresh.availability.length, 7);
  assert.equal(fresh.availability[0].available, true, 'a Friday is a working day by default');
});
