// Derives the Week dashboard from saved state. Pure: the caller passes the week's bounds in
// rather than this module reading the clock, so every number here is directly testable.

import { addDays, type PlannedDay, type ProjectRisk } from './planner.ts';
import { freshWindow, plannerProject, type AppData, type CheckInStatus } from './state.ts';

export type WeekBounds = { start: string; end: string };

export type OpenWorkItem = {
  id: string;
  title: string;
  appName: string;
  /** Sessions this project still needs that no day of the plan is holding. */
  openSessions: number;
  deadline?: string;
};

export type UpcomingDeadline = { id: string; title: string; deadline: string };

export type WeekSummary = {
  start: string;
  end: string;
  /** Days in this week's accepted plan that hold a project. */
  plannedDays: PlannedDay[];
  plannedCount: number;
  /** Days checked in as exactly 'Finished'. Partial days are counted separately. */
  completedCount: number;
  partlyCount: number;
  checkedInCount: number;
  openWork: OpenWorkItem[];
  upcomingDeadlines: UpcomingDeadline[];
  risks: ProjectRisk[];
};

/**
 * The span the dashboard reports on: exactly the seven days the plan is built from.
 *
 * These have to be the same range. The planning window starts today, so a check-in for today
 * always falls inside it and counts. Reporting a calendar Mon–Sun week instead meant that
 * marking today as finished could land outside the range and still read as zero.
 */
export function dashboardWeek(data: AppData, today: string): WeekBounds {
  const window = freshWindow(data.availability, today);
  return {
    start: window[0]?.date ?? today,
    end: window[window.length - 1]?.date ?? today,
  };
}

/**
 * The week the dashboard reports on: the one the plan actually covers.
 *
 * The availability window starts on the *next* Monday, so planning on a Friday puts the work in
 * the following week. Reporting the calendar week containing today showed an empty dashboard
 * immediately after accepting a full plan.
 */
export function weekSummary(data: AppData, bounds: WeekBounds): WeekSummary {
  const inWeek = (date: string) => date >= bounds.start && date <= bounds.end;

  const planDays = data.acceptedPlan?.days ?? [];
  const plannedDays = planDays.filter((day) => inWeek(day.date) && Boolean(day.projectId));

  const weekCheckIns = Object.values(data.checkIns ?? {}).filter((checkIn) => inWeek(checkIn.date));
  const countOf = (status: CheckInStatus) => weekCheckIns.filter((checkIn) => checkIn.status === status).length;

  const projects = data.entries
    .filter((entry) => !entry.parentId && entry.kind !== 'Idea')
    .map((entry) => ({ entry, project: plannerProject(entry) }));

  // "Still open" means work no day of the plan is holding. It cannot be expressed as
  // remainingSessions > 0, because plannerProject floors its estimate to at least one session.
  const placedSessions = (id: string) => planDays.filter((day) => day.projectId === id).length;
  const openWork: OpenWorkItem[] = projects
    .map(({ entry, project }) => ({ entry, project, openSessions: project.remainingSessions - placedSessions(entry.id) }))
    .filter(({ openSessions }) => openSessions > 0)
    .map(({ entry, project, openSessions }) => ({
      id: entry.id, title: entry.title, appName: entry.appName, openSessions,
      ...(project.deadline ? { deadline: project.deadline } : {}),
    }));

  const upcomingDeadlines: UpcomingDeadline[] = projects
    .filter(({ project }) => project.deadline !== undefined && project.deadline >= bounds.start)
    .map(({ entry, project }) => ({ id: entry.id, title: entry.title, deadline: project.deadline! }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));

  return {
    start: bounds.start,
    end: bounds.end,
    plannedDays,
    plannedCount: plannedDays.length,
    completedCount: countOf('Finished'),
    partlyCount: countOf('Partly finished'),
    checkedInCount: weekCheckIns.length,
    openWork,
    upcomingDeadlines,
    // The accepted plan already carries the risks the Plan screen renders. Reuse them rather
    // than re-deriving from a possibly different candidate set, so the two cannot disagree.
    risks: data.acceptedPlan?.risks ?? [],
  };
}
