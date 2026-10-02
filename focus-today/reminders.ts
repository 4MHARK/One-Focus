// Pure reminder rules: when a reminder is next due, what it says, and how it is identified.
//
// Scheduling itself lives in notifications.ts, which is the only module allowed to import
// expo-notifications. Keeping this file free of native imports is what lets `node --test` load
// it, so every rule below is directly testable.

export type ReminderKind = 'morning' | 'evening';

export type ReminderSetting = {
  enabled: boolean;
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
};

export type ReminderSettings = {
  morning: ReminderSetting;
  evening: ReminderSetting;
};

export const REMINDER_KINDS: readonly ReminderKind[] = ['morning', 'evening'];

export const DEFAULT_REMINDERS: ReminderSettings = {
  morning: { enabled: true, hour: 8, minute: 0 },
  evening: { enabled: true, hour: 20, minute: 0 },
};

const MINUTES_PER_DAY = 24 * 60;

const COPY: Record<ReminderKind, { title: string; body: string }> = {
  morning: { title: 'One thing for today', body: 'Open the app and settle on the single focus for today.' },
  evening: { title: 'How did today go?', body: 'A short check-in keeps the rest of the week honest.' },
};

export function reminderCopy(kind: ReminderKind): { title: string; body: string } {
  return COPY[kind];
}

/** Stable ids, so re-scheduling replaces a reminder instead of stacking a duplicate beside it. */
export function reminderIdentifier(kind: ReminderKind): string {
  return `one-thing-${kind}`;
}

/** Clamp anything into a real clock time, so malformed saved data cannot schedule at hour 99. */
export function normalizeReminder(setting: ReminderSetting): ReminderSetting {
  const hour = Number.isFinite(setting.hour) ? Math.min(23, Math.max(0, Math.floor(setting.hour))) : 0;
  const minute = Number.isFinite(setting.minute) ? Math.min(59, Math.max(0, Math.floor(setting.minute))) : 0;
  return { enabled: Boolean(setting.enabled), hour, minute };
}

export function normalizeReminders(settings: ReminderSettings): ReminderSettings {
  return { morning: normalizeReminder(settings.morning), evening: normalizeReminder(settings.evening) };
}

/** Step a time by minutes, wrapping around midnight in both directions. */
export function shiftTime(hour: number, minute: number, deltaMinutes: number): { hour: number; minute: number } {
  const total = (((hour * 60 + minute + deltaMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

/**
 * The next moment this reminder is due, from `from` onward. Once today's time has passed it
 * rolls to tomorrow, which is what the settings screen shows the user.
 */
export function nextOccurrence(hour: number, minute: number, from: Date): Date {
  const clock = normalizeReminder({ enabled: true, hour, minute });
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate(), clock.hour, clock.minute, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

/** '8:00 AM', '12:00 PM', '8:30 PM'. Fixed 12-hour format so the label is predictable. */
export function formatClockTime(hour: number, minute: number): string {
  const clock = normalizeReminder({ enabled: true, hour, minute });
  const period = clock.hour < 12 ? 'AM' : 'PM';
  const display = clock.hour % 12 === 0 ? 12 : clock.hour % 12;
  return `${display}:${String(clock.minute).padStart(2, '0')} ${period}`;
}

export type ScheduledReminder = {
  identifier: string;
  kind: ReminderKind;
  hour: number;
  minute: number;
  title: string;
  body: string;
};

/** Exactly what should be scheduled right now: the enabled reminders, in a stable order. */
export function activeReminders(settings: ReminderSettings): ScheduledReminder[] {
  return REMINDER_KINDS.filter((kind) => settings[kind]?.enabled).map((kind) => {
    const { hour, minute } = normalizeReminder(settings[kind]);
    return { identifier: reminderIdentifier(kind), kind, hour, minute, ...reminderCopy(kind) };
  });
}
