export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export type PlannerProject = {
  id: string;
  title: string;
  appName: string;
  outcome: string;
  remainingSessions: number;
  deadline?: string;
  priority: Priority;
};

export type DayAvailability = {
  date: string;
  available: boolean;
  minutes: number;
};

export type PlannedDay = {
  date: string;
  available: boolean;
  minutes: number;
  projectId: string | null;
  reason: string;
  locked: boolean;
  edited: boolean;
};

export type ProjectRisk = {
  projectId: string;
  title: string;
  unplannedSessions: number;
  deadline?: string;
  message: string;
};

export type DraftPlan = {
  days: PlannedDay[];
  risks: ProjectRisk[];
};

export type ProjectReference<P> =
  | { kind: 'assigned'; project: P }
  | { kind: 'missing'; projectId: string }
  | { kind: 'open' };

/** Resolve a saved plan reference without assuming its project still exists. */
export function resolveProjectReference<P extends { id: string }>(
  projects: readonly (P | null | undefined)[],
  projectId: unknown,
): ProjectReference<P> {
  if (projectId === null || projectId === undefined || projectId === '') return { kind: 'open' };
  if (typeof projectId === 'string') {
    const project = projects.find((candidate) => candidate?.id === projectId);
    if (project) return { kind: 'assigned', project };
  }
  return { kind: 'missing', projectId: String(projectId) };
}

const priorityOrder: Record<Priority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function nextMonday(from = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const daysUntilMonday = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + daysUntilMonday);
  return isoDate(date);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

export function makeAvailability(startDate: string, workdays: boolean[] = [true, true, true, true, true, false, false], minutes = 180): DayAvailability[] {
  const start = new Date(`${startDate}T12:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date: isoDate(date), available: workdays[index], minutes };
  });
}

export function createDraftPlan(
  projects: PlannerProject[],
  availability: DayAvailability[],
  preservedDays: PlannedDay[] = [],
): DraftPlan {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const remaining = new Map(projects.map((project) => [project.id, Math.max(0, Math.floor(project.remainingSessions))]));
  const preservedDateSet = new Set(preservedDays
    .filter((candidate) => candidate.locked || (Boolean(candidate.projectId) && !projectsById.has(candidate.projectId!)))
    .map((candidate) => candidate.date));
  const days: PlannedDay[] = availability.map((day) => {
    const prior = preservedDays.find((candidate) => candidate.date === day.date && (
      candidate.locked || (Boolean(candidate.projectId) && !projectsById.has(candidate.projectId!))
    ));
    if (prior?.projectId && remaining.has(prior.projectId)) {
      remaining.set(prior.projectId, Math.max(0, (remaining.get(prior.projectId) ?? 0) - 1));
    }
    return prior
      ? { ...prior, available: day.available, minutes: day.minutes }
      : { ...day, projectId: null, reason: '', locked: false, edited: false };
  });

  // Earliest deadline first, so dated work claims the early days before undated work can.
  // Priority only breaks ties. Undated work is planned last, however urgent it is.
  const orderedProjects = [...projects].sort((a, b) => {
    if (a.deadline !== b.deadline) {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    }
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
  for (const day of days) {
    if (!day.available || day.locked || preservedDateSet.has(day.date) || day.minutes <= 0) continue;
    const project = orderedProjects.find((candidate) => (remaining.get(candidate.id) ?? 0) > 0);
    if (!project) continue;
    day.projectId = project.id;
    day.reason = project.deadline
      ? `${project.priority[0].toUpperCase()}${project.priority.slice(1)} priority; ${project.remainingSessions} focus ${project.remainingSessions === 1 ? 'day' : 'days'} estimated. Due ${project.deadline}.`
      : `${project.priority[0].toUpperCase()}${project.priority.slice(1)} priority; ${project.remainingSessions} focus ${project.remainingSessions === 1 ? 'day' : 'days'} estimated.`;
    remaining.set(project.id, (remaining.get(project.id) ?? 1) - 1);
  }

  return { days, risks: evaluatePlanRisks(projects, days) };
}

export function evaluatePlanRisks(projects: PlannerProject[], days: PlannedDay[]): ProjectRisk[] {
  const risks: ProjectRisk[] = [];
  for (const project of projects) {
    const assignedDays = days.filter((day) => day.projectId === project.id);
    // Floor here too: createDraftPlan floors when it assigns, so comparing an unfloored
    // estimate against a floored assignment count reports sessions that do not exist.
    const remainingSessions = Math.max(0, Math.floor(project.remainingSessions));
    const unplannedSessions = Math.max(0, remainingSessions - assignedDays.length);
    const lateDay = project.deadline ? assignedDays.find((day) => day.date > project.deadline!) : undefined;
    if (unplannedSessions > 0 || lateDay) {
      const dueText = project.deadline ? ` Deadline: ${project.deadline}.` : '';
      const unplannedText = unplannedSessions > 0 ? `${unplannedSessions} focus ${unplannedSessions === 1 ? 'day does' : 'days do'} not fit in the available days.` : '';
      const lateText = lateDay ? ` A planned focus day falls after the deadline (${lateDay.date}).` : '';
      risks.push({
        projectId: project.id,
        title: project.title,
        unplannedSessions,
        deadline: project.deadline,
        message: `${unplannedText}${lateText}${dueText}`.trim(),
      });
    }
  }
  return risks;
}

export type PlanChange = {
  date: string;
  fromProjectId: string | null;
  toProjectId: string | null;
};

/**
 * Where a proposed plan differs from the current one. This is what lets a change be described as
 * trade-offs before it is accepted, instead of only as a fresh list of risks. Days that only one
 * side has are reported too, so a shortened window shows up as a change rather than vanishing.
 */
export function planChanges(before: readonly PlannedDay[], after: readonly PlannedDay[]): PlanChange[] {
  const beforeByDate = new Map(before.map((day) => [day.date, day]));
  const afterByDate = new Map(after.map((day) => [day.date, day]));
  return Array.from(new Set([...beforeByDate.keys(), ...afterByDate.keys()]))
    .sort()
    .map((date) => ({
      date,
      fromProjectId: beforeByDate.get(date)?.projectId ?? null,
      toProjectId: afterByDate.get(date)?.projectId ?? null,
    }))
    .filter((change) => change.fromProjectId !== change.toProjectId);
}

export function assignProjectToDay(days: PlannedDay[], date: string, projectId: string | null, projects: PlannerProject[]): PlannedDay[] {
  const project = projects.find((item) => item.id === projectId);
  return days.map((day) => day.date === date
    ? {
        ...day,
        projectId,
        reason: project ? `You chose this project for this day. ${project.outcome}` : 'You left this day open.',
        locked: true,
        edited: true,
      }
    : day);
}
