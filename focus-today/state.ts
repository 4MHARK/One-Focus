import { addDays, createDraftPlan, evaluatePlanRisks, makeAvailability, nextMonday, planChanges, type DayAvailability, type DraftPlan, type PlannedDay, type PlannerProject, type Priority, type ProjectRisk } from './planner.ts';
import { DEFAULT_REMINDERS, normalizeReminders, REMINDER_KINDS, type ReminderSetting, type ReminderSettings } from './reminders.ts';

// Pure application state for One Thing: the data shape, the transitions that change it,
// and the validation at both storage boundaries. No React and no storage, and the only
// clock is a reference date passed in — so every rule here is directly testable.

export type Kind = 'Coding' | 'Assignment' | 'Course' | 'Idea';
export type WorkMode = 'Planning' | 'Learning' | 'Debugging' | 'Coding' | 'Writing' | 'Other';
export type EntryState = 'planned' | 'inbox';

export type Entry = {
  id: string;
  title: string;
  appName: string;
  kind: Kind;
  workModes: WorkMode[];
  description: string;
  outcome: string;
  todayGoal: string;
  firstStep: string;
  nextStep?: string;
  todayReason: string;
  done: string;
  remaining: string;
  blocker: string;
  deadline: string;
  remainingSessions?: number;
  priority?: Priority;
  state: EntryState;
  parentId?: string;
};

export const CHECK_IN_STATUSES = ['Finished', 'Partly finished', 'Stuck', "Didn't start"] as const;
export type CheckInStatus = (typeof CHECK_IN_STATUSES)[number];

export type CheckIn = {
  /** Local date this check-in belongs to, so a finished week can be counted afterwards. */
  date: string;
  projectId: string;
  status: CheckInStatus;
  accomplished: string;
  remaining: string;
  blocker: string;
  savedAt: string;
};

/**
 * The single check-in written before check-ins were dated. It has no date and no project, so it
 * cannot be placed on a timeline. Kept verbatim and shown nowhere rather than discarded.
 */
export type LegacyCheckIn = { status: string; accomplished: string; remaining: string; blocker: string; savedAt: string };

export type TodayActionProgress = {
  date: string;
  currentAction: string;
  completedActions: string[];
  doneForToday: boolean;
};

/** Everything the app persists. One object, one storage key. */
export type AppData = {
  entries: Entry[];
  /** Keyed `date|projectId`, so each day keeps its own check-in and a week can be counted. */
  checkIns: Record<string, CheckIn>;
  legacyCheckIn: LegacyCheckIn | null;
  todayProjectId: string;
  availability: DayAvailability[];
  selectedProjectIds: string[];
  acceptedPlan: DraftPlan | null;
  /** Keyed by local date and project ID so one day's actions never finish the project. */
  todayActionProgress: Record<string, TodayActionProgress>;
  reminders: ReminderSettings;
  /** Whether the first-run tour has been seen. Absent in older rows, which show it once. */
  tourSeen: boolean;
};

export type BackupFile = { format: 'one-thing-backup'; version: 1; exportedAt: string; data: AppData };

export type ParseResult = { ok: true; data: AppData } | { ok: false; reason: string };

const fail = (reason: string): ParseResult => ({ ok: false, reason });

const KINDS: readonly Kind[] = ['Coding', 'Assignment', 'Course', 'Idea'];
const WORK_MODES: readonly WorkMode[] = ['Planning', 'Learning', 'Debugging', 'Coding', 'Writing', 'Other'];
const PRIORITIES: readonly Priority[] = ['low', 'normal', 'high', 'urgent'];

const INVALID_BACKUP = 'This backup is not valid or uses an unsupported version. Your saved data was not changed.';
export const UNREADABLE_BACKUP = 'I could not read that JSON. Your saved data was not changed.';

/** Seven days starting today, with the real weekdays available. */
function startingWindow(today: Date): DayAvailability[] {
  return makeAvailability(localDateKey(today)).map((day) => {
    const weekday = new Date(`${day.date}T12:00:00`).getDay();
    return { ...day, available: weekday >= 1 && weekday <= 5 };
  });
}

/** A brand-new install: nothing captured yet, and a window that starts on the day you open it. */
export function createInitialData(today: Date = new Date()): AppData {
  return {
    entries: [],
    checkIns: {},
    legacyCheckIn: null,
    todayProjectId: '',
    availability: startingWindow(today),
    selectedProjectIds: [],
    acceptedPlan: null,
    todayActionProgress: {},
    reminders: normalizeReminders(DEFAULT_REMINDERS),
    tourSeen: false,
  };
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Every per-project, per-day record — action progress and check-ins alike — shares this key
 * shape. It lives in one place because `removeEntry` prunes these records by suffix.
 */
function dayProjectKey(date: string, projectId: string): string {
  return `${date}|${projectId}`;
}

/** Drop every per-project, per-day record belonging to one project. */
function withoutProject<T>(records: Record<string, T> | undefined, id: string): Record<string, T> {
  return Object.fromEntries(Object.entries(records ?? {}).filter(([key]) => !key.endsWith(`|${id}`)));
}

export function getCheckIn(data: AppData, projectId: string, date: string): CheckIn | null {
  return data.checkIns?.[dayProjectKey(date, projectId)] ?? null;
}

/** Every check-in inside a date range, oldest first. Used by the week dashboard. */
export function checkInsInRange(data: AppData, start: string, end: string): CheckIn[] {
  return Object.values(data.checkIns ?? {})
    .filter((checkIn) => checkIn.date >= start && checkIn.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function setReminders(data: AppData, reminders: ReminderSettings): AppData {
  return { ...data, reminders: normalizeReminders(reminders) };
}

/** Mark the first-run tour as seen, so it is shown exactly once. */
export function finishTour(data: AppData): AppData {
  return { ...data, tourSeen: true };
}

export function getTodayActionProgress(data: AppData, projectId: string, date = localDateKey()): TodayActionProgress {
  const key = dayProjectKey(date, projectId);
  const saved = data.todayActionProgress?.[key];
  if (saved) return saved;
  const project = data.entries.find((entry) => entry.id === projectId);
  // Both optional: the validator refuses an entry with no first step, and the extra ?. means a
  // missing one reads as "no action yet" instead of throwing on the Today screen.
  return { date, currentAction: project?.firstStep?.trim() ?? '', completedActions: [], doneForToday: false };
}

export function completeTodayAction(data: AppData, projectId: string, date = localDateKey()): AppData {
  const progress = getTodayActionProgress(data, projectId, date);
  const action = progress.currentAction.trim();
  if (!action || progress.doneForToday) return data;
  const project = data.entries.find((entry) => entry.id === projectId);
  const suppliedNextAction = progress.completedActions.length === 0 ? project?.nextStep?.trim() ?? '' : '';
  return {
    ...data,
    todayActionProgress: {
      ...data.todayActionProgress,
      [dayProjectKey(date, projectId)]: {
        ...progress, currentAction: suppliedNextAction, completedActions: [...progress.completedActions, action], doneForToday: false,
      },
    },
  };
}

export function saveTodayAction(data: AppData, projectId: string, action: string, date = localDateKey()): AppData {
  const progress = getTodayActionProgress(data, projectId, date);
  const nextAction = action.trim();
  if (!nextAction || progress.currentAction.trim() || progress.doneForToday) return data;
  return {
    ...data,
    todayActionProgress: {
      ...data.todayActionProgress,
      [dayProjectKey(date, projectId)]: { ...progress, currentAction: nextAction },
    },
  };
}

export function finishToday(data: AppData, projectId: string, date = localDateKey()): AppData {
  const progress = getTodayActionProgress(data, projectId, date);
  if (progress.doneForToday) return data;
  return {
    ...data,
    todayActionProgress: {
      ...data.todayActionProgress,
      [dayProjectKey(date, projectId)]: { ...progress, doneForToday: true },
    },
  };
}

export function continueToday(data: AppData, projectId: string, date = localDateKey()): AppData {
  const progress = getTodayActionProgress(data, projectId, date);
  if (!progress.doneForToday) return data;
  return {
    ...data,
    todayActionProgress: {
      ...data.todayActionProgress,
      [dayProjectKey(date, projectId)]: { ...progress, doneForToday: false },
    },
  };
}

export function plannerProject(entry: Entry): PlannerProject {
  const requestedSessions = Number(entry.remainingSessions);
  return {
    id: entry.id, title: entry.title, appName: entry.appName, outcome: entry.outcome,
    remainingSessions: Number.isFinite(requestedSessions) && requestedSessions >= 1 ? Math.floor(requestedSessions) : 1,
    ...(entry.deadline && /^\d{4}-\d{2}-\d{2}$/.test(entry.deadline) ? { deadline: entry.deadline } : {}),
    priority: PRIORITIES.includes(entry.priority as Priority) ? entry.priority! : 'normal',
  };
}

/** Projects worth re-scoring when a plan changes: the selected ones plus anything already placed. */
export function candidatesForDays(entries: Entry[], selectedProjectIds: string[], days: PlannedDay[]): PlannerProject[] {
  const assignedIds = new Set(days.map((day) => day.projectId).filter((id): id is string => Boolean(id)));
  return entries
    .filter((entry) => selectedProjectIds.includes(entry.id) || assignedIds.has(entry.id))
    .map(plannerProject);
}

// --- transitions -------------------------------------------------------------------
// Each returns new AppData and never mutates its input.

export function addEntry(data: AppData, entry: Omit<Entry, 'id'>, id: string): AppData {
  return { ...data, entries: [{ ...entry, id }, ...data.entries] };
}

export function updateEntry(data: AppData, entry: Entry): AppData {
  return { ...data, entries: data.entries.map((item) => item.id === entry.id ? entry : item) };
}

export function chooseTodayProject(data: AppData, id: string): AppData {
  // This used to clear the check-in, because there was a single global slot that belonged to the
  // previous focus. Check-ins are dated now, so switching focus must not erase yesterday's — or
  // today's earlier project's — record.
  return {
    ...data,
    todayProjectId: id,
    entries: data.entries.map((item) => item.id === id ? { ...item, state: 'planned' } : item),
  };
}

/** Record a check-in. A later one for the same day and project replaces the earlier one. */
export function saveCheckIn(data: AppData, checkIn: CheckIn): AppData {
  return { ...data, checkIns: { ...data.checkIns, [dayProjectKey(checkIn.date, checkIn.projectId)]: checkIn } };
}

export function setAvailability(data: AppData, availability: DayAvailability[]): AppData {
  return { ...data, availability };
}

export function setSelectedProjectIds(data: AppData, selectedProjectIds: string[]): AppData {
  return { ...data, selectedProjectIds };
}

export function setAcceptedPlan(data: AppData, acceptedPlan: DraftPlan | null): AppData {
  return { ...data, acceptedPlan };
}

/** Re-score risks after one day of the accepted plan changes. An unknown day is ignored. */
export function updatePlanDay(data: AppData, day: PlannedDay): AppData {
  const plan = data.acceptedPlan;
  if (!plan || !day) return data;
  if (!plan.days.some((item) => item.date === day.date)) return data;
  const days = plan.days.map((item) => item.date === day.date ? day : item);
  return { ...data, acceptedPlan: { ...plan, days, risks: evaluatePlanRisks(candidatesForDays(data.entries, data.selectedProjectIds, days), days) } };
}

/** Accepting a plan places its projects and returns everything else to the Inbox. */
export function acceptPlan(data: AppData, plan: DraftPlan): AppData {
  const assigned = new Set(plan.days.map((day) => day.projectId).filter((id): id is string => Boolean(id)));
  return {
    ...data,
    acceptedPlan: plan,
    entries: data.entries.map((item) => item.parentId || item.kind === 'Idea' ? item
      : assigned.has(item.id) || item.id === data.todayProjectId ? { ...item, state: 'planned' }
      : item.state === 'planned' ? { ...item, state: 'inbox' } : item),
  };
}

/** Replace everything, as a restore does. */
export function replaceData(_current: AppData, incoming: AppData): AppData {
  return incoming;
}

/**
 * Whether the app may write to storage. A row that failed to load is never written over,
 * so an unreadable or corrupt row cannot be replaced by starter data.
 */
export function shouldPersist(state: { hydrated: boolean; loadProblem: string | null }): boolean {
  return state.hydrated && state.loadProblem === null;
}

/**
 * Release the days a deleted project was holding. The days stay in place and go back to
 * open rather than being re-planned, so nothing else silently moves.
 */
export function clearProjectFromDays(days: PlannedDay[], id: string): PlannedDay[] {
  return days.map((day) => day.projectId === id ? { ...day, projectId: null, reason: '' } : day);
}

/** Remove a project from the list, the draft selection, today's focus, and any plan day holding it. */
export function removeEntry(data: AppData, id: string): AppData {
  const entries = data.entries.filter((entry) => entry.id !== id);
  const selectedProjectIds = data.selectedProjectIds.filter((projectId) => projectId !== id);
  // Drop the project's per-day history across every date, both actions and check-ins. The key
  // embeds the project id, so leaving either behind would resurrect old history if a project
  // with the same id came back — and would sit in storage and backups forever otherwise.
  const todayActionProgress = withoutProject(data.todayActionProgress, id);
  const checkIns = withoutProject(data.checkIns, id);
  const plan = data.acceptedPlan;
  let acceptedPlan = plan;
  if (plan && plan.days.some((day) => day.projectId === id)) {
    const days = clearProjectFromDays(plan.days, id);
    acceptedPlan = { ...plan, days, risks: evaluatePlanRisks(candidatesForDays(entries, selectedProjectIds, days), days) };
  }
  const nextFocus = entries.find((entry) => !entry.parentId && entry.kind !== 'Idea');
  const todayProjectId = data.todayProjectId === id ? nextFocus?.id ?? '' : data.todayProjectId;
  return { ...data, entries, selectedProjectIds, todayActionProgress, checkIns, acceptedPlan, todayProjectId };
}

// --- replanning after a check-in ----------------------------------------------------

/**
 * The complete persisted shape, gathered from a value that carries more than AppData (the
 * provider hands its whole context to screens). Backups go through this so that adding a field
 * to AppData cannot silently leave it out of an export.
 */
export function toAppData(data: AppData): AppData {
  return {
    entries: data.entries,
    checkIns: data.checkIns,
    legacyCheckIn: data.legacyCheckIn,
    todayProjectId: data.todayProjectId,
    availability: data.availability,
    selectedProjectIds: data.selectedProjectIds,
    acceptedPlan: data.acceptedPlan,
    todayActionProgress: data.todayActionProgress,
    reminders: data.reminders,
    tourSeen: data.tourSeen,
  };
}

/** Whether a status means the session was actually spent on the project. */
export function statusSpendsSession(status: CheckInStatus): boolean {
  return status === 'Finished' || status === 'Partly finished' || status === 'Stuck';
}

/**
 * The one place the check-in → replanning rules live.
 *
 * - A session counts against the estimate only when work actually happened, so "Didn't start"
 *   leaves the estimate alone.
 * - A day the work did not happen on is treated as spent, so its work moves.
 * - "Finished" changes nothing by itself. It still offers a proposal — finishing early must not
 *   fill free time on its own — but the offer has to be accepted like any other.
 */
export function replanOptionsFor(status: CheckInStatus, projectId: string, date: string): { today: string; spentProjectId?: string; spentDay?: string } {
  return {
    today: date,
    ...(statusSpendsSession(status) ? { spentProjectId: projectId } : {}),
    ...(status === "Didn't start" ? { spentDay: date } : {}),
  };
}

/**
 * The availability window, rolled forward when the saved one has already passed. Availability is
 * written once and only re-dated by hand, so without this a proposal would plan for last week.
 * The weekday pattern the user chose is preserved.
 */
export function freshWindow(availability: DayAvailability[], today: string): DayAvailability[] {
  const lastDate = availability.reduce((latest, day) => (day.date > latest ? day.date : latest), '');
  if (lastDate >= today) return availability;
  // Roll forward to start today, so the day you are actually on is always inside the window and
  // a check-in for it always counts. The weekday pattern the user chose is carried over by
  // weekday rather than by position, so "Mondays are off" stays true after a roll.
  const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00`).getDay();
  const byWeekday = new Map(availability.map((day) => [weekdayOf(day.date), day]));
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index);
    const prior = byWeekday.get(weekdayOf(date));
    return {
      date,
      available: prior?.available ?? (weekdayOf(date) >= 1 && weekdayOf(date) <= 5),
      minutes: prior?.minutes ?? 180,
    };
  });
}

export type ReplanChange = { date: string; fromTitle: string | null; toTitle: string | null };
export type ReplanAdjustment = { projectId: string; title: string; from: number; to: number };

export type ReplanProposal = {
  plan: DraftPlan;
  changes: ReplanChange[];
  risks: ProjectRisk[];
  adjustments: ReplanAdjustment[];
  /** The availability the proposal was built against. Accepting should adopt it too. */
  window: DayAvailability[];
  /** True when the saved week had already passed and the proposal moved onto the current one. */
  rolled: boolean;
};

/**
 * What the plan becomes after a check-in. `spentProjectId` is the project the session was spent
 * on; passing it decrements that estimate by one, which is what makes the proposal differ from
 * the current plan at all — with unchanged inputs the allocation is deterministic and identical.
 * Locked days are preserved by createDraftPlan, so the change is only ever the unlocked rest.
 */
export function replanProposal(data: AppData, options: { today: string; spentProjectId?: string; spentDay?: string }): ReplanProposal | null {
  const accepted = data.acceptedPlan;
  if (!accepted) return null;

  const adjustments: ReplanAdjustment[] = [];
  const entries = data.entries.map((entry) => {
    if (entry.id !== options.spentProjectId) return entry;
    const from = plannerProject(entry).remainingSessions;
    if (from <= 1) return entry;
    adjustments.push({ projectId: entry.id, title: entry.title, from, to: from - 1 });
    return { ...entry, remainingSessions: from - 1 };
  });

  // Candidates must include what the accepted plan already holds, not just the selected ids:
  // createDraftPlan freezes any day whose project is absent from the list it is given, and such
  // a day would then be missing from the risks too — frozen and invisible.
  const projects = candidatesForDays(entries, data.selectedProjectIds, accepted.days);
  const fresh = freshWindow(data.availability, options.today);
  const rolled = fresh !== data.availability;
  // A day the work did not happen on is gone. Marking it unavailable re-places the remaining
  // sessions into the days that are left, instead of leaving them sitting on a day that passed.
  const window = options.spentDay
    ? fresh.map((day) => day.date === options.spentDay ? { ...day, available: false, minutes: 0 } : day)
    : fresh;
  const plan = createDraftPlan(projects, window, accepted.days);
  const titleOf = (id: string | null) => id === null ? null : data.entries.find((entry) => entry.id === id)?.title ?? 'A project no longer in your list';

  return {
    plan,
    window,
    rolled,
    adjustments,
    risks: plan.risks,
    changes: planChanges(accepted.days, plan.days).map((change) => ({
      date: change.date, fromTitle: titleOf(change.fromProjectId), toTitle: titleOf(change.toProjectId),
    })),
  };
}

// --- validation at the storage boundaries -------------------------------------------
// Hydration and backup restore run the same checks, so a row this app writes is always one
// it can read back, and a row it cannot fully read is never accepted as valid.

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== 'string' || typeof entry.title !== 'string') return false;
  if (!KINDS.includes(entry.kind as Kind)) return false;
  if (entry.state !== 'planned' && entry.state !== 'inbox') return false;
  if (typeof entry.appName !== 'string') return false;
  // Read as a string by the Today screen, so a row without it is refused rather than crashing.
  if (typeof entry.firstStep !== 'string') return false;
  if (entry.nextStep !== undefined && typeof entry.nextStep !== 'string') return false;
  // The UI calls .length and .join on workModes and .toUpperCase on kind, so both must be real.
  if (!Array.isArray(entry.workModes) || !entry.workModes.every((mode) => WORK_MODES.includes(mode as WorkMode))) return false;
  if (entry.parentId !== undefined && typeof entry.parentId !== 'string') return false;
  if (entry.deadline !== undefined && typeof entry.deadline !== 'string') return false;
  if (entry.priority !== undefined && !PRIORITIES.includes(entry.priority as Priority)) return false;
  if (entry.remainingSessions !== undefined && (typeof entry.remainingSessions !== 'number' || !Number.isFinite(entry.remainingSessions))) return false;
  return true;
}

function hasCheckInText(value: Record<string, unknown>): boolean {
  return typeof value.accomplished === 'string' && typeof value.remaining === 'string'
    && typeof value.blocker === 'string' && typeof value.savedAt === 'string';
}

function isCheckIn(value: unknown): value is CheckIn {
  if (!value || typeof value !== 'object') return false;
  const checkIn = value as Record<string, unknown>;
  if (typeof checkIn.date !== 'string' || typeof checkIn.projectId !== 'string') return false;
  if (!CHECK_IN_STATUSES.includes(checkIn.status as CheckInStatus)) return false;
  return hasCheckInText(checkIn);
}

/** The pre-Checkpoint-3 check-in had no date or project, so only its text fields can be checked. */
function isLegacyCheckIn(value: unknown): value is LegacyCheckIn {
  if (!value || typeof value !== 'object') return false;
  const checkIn = value as Record<string, unknown>;
  return typeof checkIn.status === 'string' && hasCheckInText(checkIn);
}

function isCheckInsMap(value: unknown): value is Record<string, CheckIn> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(isCheckIn);
}

function isReminderSetting(value: unknown): value is ReminderSetting {
  if (!value || typeof value !== 'object') return false;
  const setting = value as Record<string, unknown>;
  return typeof setting.enabled === 'boolean'
    && typeof setting.hour === 'number' && Number.isFinite(setting.hour)
    && typeof setting.minute === 'number' && Number.isFinite(setting.minute);
}

function isReminderSettings(value: unknown): value is ReminderSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Record<string, unknown>;
  return REMINDER_KINDS.every((kind) => isReminderSetting(settings[kind]));
}

function isAvailabilityDay(value: unknown): value is DayAvailability {
  if (!value || typeof value !== 'object') return false;
  const day = value as Record<string, unknown>;
  return typeof day.date === 'string' && typeof day.available === 'boolean'
    && typeof day.minutes === 'number' && Number.isFinite(day.minutes);
}

function isPlannedDay(value: unknown): value is PlannedDay {
  if (!value || typeof value !== 'object') return false;
  const day = value as Record<string, unknown>;
  if (typeof day.date !== 'string' || typeof day.available !== 'boolean' || typeof day.minutes !== 'number') return false;
  return day.projectId === null || day.projectId === undefined || typeof day.projectId === 'string';
}

function isProjectRisk(value: unknown): value is ProjectRisk {
  if (!value || typeof value !== 'object') return false;
  const risk = value as Record<string, unknown>;
  return typeof risk.projectId === 'string' && typeof risk.title === 'string' && typeof risk.message === 'string';
}

function isDraftPlan(value: unknown): value is DraftPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Record<string, unknown>;
  return Array.isArray(plan.days) && plan.days.every(isPlannedDay)
    && Array.isArray(plan.risks) && plan.risks.every(isProjectRisk);
}

function isTodayActionProgressMap(value: unknown): value is Record<string, TodayActionProgress> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => {
    if (!item || typeof item !== 'object') return false;
    const progress = item as Record<string, unknown>;
    return typeof progress.date === 'string' && typeof progress.currentAction === 'string'
      && Array.isArray(progress.completedActions) && progress.completedActions.every((action) => typeof action === 'string')
      && typeof progress.doneForToday === 'boolean';
  });
}

/** Validate and normalize a persisted AppData object. */
export function validateAppData(value: unknown): ParseResult {
  if (!value || typeof value !== 'object') return fail('The saved data is not a set of app fields.');
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.entries) || !raw.entries.every(isEntry)) return fail('One or more saved projects are incomplete.');
  if (!Array.isArray(raw.availability) || !raw.availability.every(isAvailabilityDay)) return fail('The saved availability is incomplete.');
  if (!Array.isArray(raw.selectedProjectIds) || !raw.selectedProjectIds.every((id) => typeof id === 'string')) return fail('The saved project selection is incomplete.');
  if (typeof raw.todayProjectId !== 'string') return fail('The saved focus is incomplete.');
  if (raw.checkIns !== undefined && !isCheckInsMap(raw.checkIns)) return fail('The saved check-ins are incomplete.');
  if (raw.legacyCheckIn !== undefined && raw.legacyCheckIn !== null && !isLegacyCheckIn(raw.legacyCheckIn)) return fail('The saved check-in is incomplete.');
  if (raw.acceptedPlan !== null && raw.acceptedPlan !== undefined && !isDraftPlan(raw.acceptedPlan)) return fail('The saved plan is incomplete.');
  if (raw.todayActionProgress !== undefined && !isTodayActionProgressMap(raw.todayActionProgress)) return fail('The saved Today actions are incomplete.');
  if (raw.reminders !== undefined && !isReminderSettings(raw.reminders)) return fail('The saved reminders are incomplete.');

  // Rows written before check-ins were dated carried one undated check-in under `checkIn`.
  // Move it to `legacyCheckIn` so nothing is discarded, and never write that field again. A
  // malformed legacy value is dropped rather than failing the whole row, since the field is
  // no longer read by anything.
  const legacyCheckIn = raw.legacyCheckIn !== undefined && raw.legacyCheckIn !== null
    ? (raw.legacyCheckIn as LegacyCheckIn)
    : (isLegacyCheckIn(raw.checkIn) ? raw.checkIn : null);

  return {
    ok: true,
    data: {
      entries: raw.entries,
      checkIns: (raw.checkIns as Record<string, CheckIn> | undefined) ?? {},
      legacyCheckIn,
      todayProjectId: raw.todayProjectId,
      availability: raw.availability,
      selectedProjectIds: raw.selectedProjectIds,
      acceptedPlan: raw.acceptedPlan ?? null,
      todayActionProgress: (raw.todayActionProgress as Record<string, TodayActionProgress> | undefined) ?? {},
      reminders: isReminderSettings(raw.reminders) ? normalizeReminders(raw.reminders) : normalizeReminders(DEFAULT_REMINDERS),
      tourSeen: raw.tourSeen === true,
    },
  };
}

/** Read the row this app writes under its own storage key. */
export function parseStoredState(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('Saved data on this device is not valid JSON.');
  }
  return validateAppData(parsed);
}

export function serializeBackup(data: AppData, exportedAt: string): string {
  const file: BackupFile = { format: 'one-thing-backup', version: 1, exportedAt, data };
  return JSON.stringify(file, null, 2);
}

/** Read pasted backup text. */
export function parseBackup(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(UNREADABLE_BACKUP);
  }
  if (!parsed || typeof parsed !== 'object') return fail(INVALID_BACKUP);
  const file = parsed as Record<string, unknown>;
  if (file.format !== 'one-thing-backup' || file.version !== 1) return fail(INVALID_BACKUP);
  const result = validateAppData(file.data);
  return result.ok ? result : fail(INVALID_BACKUP);
}
