import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { APP_NAME, APP_TAGLINE, greeting } from './brand';
import { motionDuration, motionOffset, MOTION } from './motion';
import { assignProjectToDay, createDraftPlan, evaluatePlanRisks, makeAvailability, nextMonday, resolveProjectReference, type DayAvailability, type DraftPlan, type PlannedDay, type Priority } from './planner';
import { acceptPlan, addEntry, candidatesForDays, chooseTodayProject, clearProjectFromDays, completeTodayAction, continueToday, createInitialData, finishToday, freshWindow, getCheckIn, getTodayActionProgress, localDateKey, parseBackup, parseStoredState, plannerProject, removeEntry, replaceData, finishTour, replanOptionsFor, replanProposal, saveCheckIn, saveTodayAction, serializeBackup, setAcceptedPlan, setAvailability, setReminders, setSelectedProjectIds, shouldPersist, toAppData, updateEntry, updatePlanDay, type AppData, type CheckIn, type CheckInStatus, type Entry, type Kind, type ReplanProposal, type WorkMode } from './state';
import { dashboardWeek, weekSummary, type WeekSummary } from './week';
import { formatClockTime, REMINDER_KINDS, shiftTime, type ReminderKind, type ReminderSetting, type ReminderSettings } from './reminders';
import { requestPermission, sendTestNotification, syncReminders, type NotificationPermission } from './notifications';

const C = {
  paper: '#F6F5EF', white: '#FFFFFF', ink: '#1E3027', muted: '#778078',
  green: '#295840', greenLight: '#E4EEE6', line: '#E8E8DF', yellow: '#F4E7C7',
  yellowInk: '#846522', blue: '#E8EDF0', blueInk: '#516773', orange: '#F3E4D8',
};

type PrototypeState = AppData & {
  addEntry: (entry: Omit<Entry, 'id'>, id?: string) => void;
  updateEntry: (entry: Entry) => void;
  saveCheckIn: (checkIn: CheckIn) => void;
  completeTodayAction: (projectId: string, date: string) => void;
  saveTodayAction: (projectId: string, action: string, date: string) => void;
  finishToday: (projectId: string, date: string) => void;
  continueToday: (projectId: string, date: string) => void;
  chooseTodayProject: (id: string) => void;
  setAvailability: (days: DayAvailability[]) => void;
  setSelectedProjectIds: (ids: string[]) => void;
  setAcceptedPlan: (plan: DraftPlan | null) => void;
  updatePlanDay: (day: PlannedDay) => void;
  acceptPlan: (plan: DraftPlan) => void;
  removeEntry: (id: string) => void;
  restoreData: (data: AppData) => void;
  setReminders: (settings: ReminderSettings) => void;
  finishTour: () => void;
  hydrated: boolean;
  loadProblem: string | null;
  persistenceStatus: 'loading' | 'saving' | 'saved' | 'error';
  notificationStatus: NotificationPermission;
  requestNotificationPermission: () => void;
  sendTestNotification: () => void;
  startFresh: () => void;
};

const PrototypeContext = createContext<PrototypeState | null>(null);

const STORAGE_KEY = 'one-thing:app-state:v2';

export function PrototypeProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(() => createInitialData());
  const [hydrated, setHydrated] = useState(false);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission>('unknown');

  useEffect(() => {
    let active = true;
    Storage.getItem(STORAGE_KEY).then((raw) => {
      if (!active) return;
      if (raw) {
        const result = parseStoredState(raw);
        if (result.ok) setData(result.data);
        else { setLoadProblem(result.reason); setPersistenceStatus('error'); }
      }
      setHydrated(true);
    }).catch(() => {
      if (!active) return;
      setLoadProblem('Saved data on this device could not be read.');
      setPersistenceStatus('error');
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  // Never write over a row we could not read. A failed load must not cost the user their data,
  // so saving stays off until they restore a backup or explicitly start fresh.
  useEffect(() => {
    if (!shouldPersist({ hydrated, loadProblem })) return;
    let active = true;
    setPersistenceStatus('saving');
    Storage.setItem(STORAGE_KEY, JSON.stringify(data)).then(() => {
      if (active) setPersistenceStatus('saved');
    }).catch(() => {
      if (active) setPersistenceStatus('error');
    });
    return () => { active = false; };
  }, [data, hydrated, loadProblem]);

  // Keep the scheduled reminders in step with the saved settings. This also runs on a cold start
  // and after a restore, so a reinstall or a restored backup re-arms the reminders rather than
  // leaving the device with none. It never asks for permission by itself.
  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    syncReminders(data.reminders).then((status) => { if (active) setNotificationStatus(status); });
    return () => { active = false; };
  }, [hydrated, data.reminders]);

  const updateAndPersist = (transition: (old: AppData) => AppData) => {
    setPersistenceStatus(loadProblem ? 'error' : 'saving');
    setData(transition);
  };

  const value: PrototypeState = {
    ...data,
    addEntry: (entry, id = `capture-${Date.now()}`) => updateAndPersist((old) => addEntry(old, entry, id)),
    updateEntry: (entry) => updateAndPersist((old) => updateEntry(old, entry)),
    saveCheckIn: (checkIn) => updateAndPersist((old) => saveCheckIn(old, checkIn)),
    completeTodayAction: (projectId, date) => updateAndPersist((old) => completeTodayAction(old, projectId, date)),
    saveTodayAction: (projectId, action, date) => updateAndPersist((old) => saveTodayAction(old, projectId, action, date)),
    finishToday: (projectId, date) => updateAndPersist((old) => finishToday(old, projectId, date)),
    continueToday: (projectId, date) => updateAndPersist((old) => continueToday(old, projectId, date)),
    chooseTodayProject: (id) => updateAndPersist((old) => chooseTodayProject(old, id)),
    setAvailability: (days) => updateAndPersist((old) => setAvailability(old, days)),
    setSelectedProjectIds: (ids) => updateAndPersist((old) => setSelectedProjectIds(old, ids)),
    setAcceptedPlan: (plan) => updateAndPersist((old) => setAcceptedPlan(old, plan)),
    updatePlanDay: (day) => updateAndPersist((old) => updatePlanDay(old, day)),
    acceptPlan: (plan) => updateAndPersist((old) => acceptPlan(old, plan)),
    removeEntry: (id) => updateAndPersist((old) => removeEntry(old, id)),
    setReminders: (settings) => updateAndPersist((old) => setReminders(old, settings)),
    finishTour: () => updateAndPersist((old) => finishTour(old)),
    restoreData: (incoming) => { updateAndPersist((old) => replaceData(old, incoming)); setLoadProblem(null); },
    // Permission is only ever requested from an explicit tap, never on first launch.
    requestNotificationPermission: () => { requestPermission().then(setNotificationStatus); },
    sendTestNotification: () => { sendTestNotification().then(setNotificationStatus); },
    hydrated,
    loadProblem,
    persistenceStatus,
    notificationStatus,
    startFresh: () => { updateAndPersist(() => createInitialData()); setLoadProblem(null); },
  };
  return <PrototypeContext.Provider value={value}>{children}</PrototypeContext.Provider>;
}

function usePrototype() {
  const value = useContext(PrototypeContext);
  if (!value) throw new Error('Prototype screens must be inside PrototypeProvider');
  return value;
}

const TOUR_STEPS: { title: string; body: string }[] = [
  { title: `Welcome to ${APP_NAME}`, body: 'A quiet place to choose one focus a day — and actually finish it.' },
  { title: 'Capture first', body: 'Write down anything you might focus on, in your own words. Nothing is scheduled yet, so nothing is committed.' },
  { title: 'Plan your days', body: 'Pick the days you can work and roughly how long you have. The app drafts a plan; you review it and decide what to accept.' },
  { title: 'One thing at a time', body: 'Today shows a single project and a single next action. Mark it done as you go, or stop for the day.' },
  { title: 'Look back, then adjust', body: 'Check in at the end of the day. If things slipped, the app proposes what to change and explains the trade-offs first.' },
];

/** The first-run walkthrough. Shown once, then never again. */
function OnboardingTour({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === TOUR_STEPS.length - 1;
  return <View style={styles.tourBackdrop}>
    <Text style={styles.tourStep}>{step + 1} OF {TOUR_STEPS.length}</Text>
    <Text style={styles.tourTitle}>{TOUR_STEPS[step].title}</Text>
    <Text style={styles.tourBody}>{TOUR_STEPS[step].body}</Text>
    <View style={styles.tourDots}>{TOUR_STEPS.map((_, index) => <View key={index} style={[styles.tourDot, index === step && styles.tourDotOn]} />)}</View>
    <PrimaryButton label={last ? 'Get started' : 'Next'} onPress={() => { if (last) onFinish(); else setStep(step + 1); }} />
    <View style={styles.tourRow}>
      {step > 0 ? <Pressable onPress={() => setStep(step - 1)} accessibilityRole="button" hitSlop={10}><Text style={styles.tourLink}>Back</Text></Pressable> : <View />}
      <Pressable onPress={onFinish} accessibilityRole="button" hitSlop={10}><Text style={styles.tourLink}>{last ? ' ' : 'Skip'}</Text></Pressable>
    </View>
  </View>;
}

/** Rendered above the tabs, so the walkthrough covers the whole app on first launch. */
export function TourGate() {
  const state = usePrototype();
  if (state.tourSeen) return null;
  return <OnboardingTour onFinish={state.finishTour} />;
}

/** Shown on a fresh install, or whenever there is nothing to focus on yet. */
function NothingYet({ eyebrow, title, heading, body, action, onAction }: { eyebrow: string; title: string; heading: string; body: string; action: string; onAction: () => void }) {
  return <Page>
    <Eyebrow>{eyebrow}</Eyebrow>
    <Title subtitle="One project. One clear next step.">{title}</Title>
    <Card><Text style={styles.safePlanTitle}>{heading}</Text><Text style={styles.safePlanText}>{body}</Text></Card>
    <PrimaryButton label={action} onPress={onAction} />
  </Page>;
}

export function TodayRoute() {
  const router = useRouter();
  const state = usePrototype();
  const { entries, todayProjectId } = state;
  const entry = entries.find((item) => item.id === todayProjectId);
  const date = localDateKey();
  // A brand-new app lands here, so this greets too — otherwise the first thing anyone sees
  // is a bare "Today" and the greeting never appears until they have captured something.
  if (!entry) return <NothingYet eyebrow="NOTHING YET" title={greeting(new Date().getHours())} heading="Start with one thing"
    body="Capture whatever you want to focus on in your Inbox. Nothing is scheduled until you put it on a plan."
    action="Capture something" onAction={() => router.navigate('/inbox')} />;
  const actionProgress = getTodayActionProgress(state, entry.id, date);
  const checkIn = getCheckIn(state, entry.id, date);
  return <TodayScreen key={`${entry.id}:${date}`} entry={entry} checkIn={checkIn} actionProgress={actionProgress} persistenceStatus={state.persistenceStatus}
    onActionDone={() => state.completeTodayAction(entry.id, date)}
    onSaveAction={(action) => state.saveTodayAction(entry.id, action, date)}
    onDoneForToday={() => state.finishToday(entry.id, date)}
    onContinue={() => state.continueToday(entry.id, date)}
    onReview={() => router.navigate('/review')} />;
}
export function PlanRoute() { return <PlanScreen {...usePrototype()} />; }
export function InboxRoute() { const { entries, addEntry, updateEntry, todayProjectId, chooseTodayProject } = usePrototype(); return <InboxScreen entries={entries} addEntry={addEntry} updateEntry={updateEntry} todayProjectId={todayProjectId} chooseTodayProject={chooseTodayProject} />; }
export function ReviewRoute() {
  const router = useRouter();
  const state = usePrototype();
  const { entries, todayProjectId, persistenceStatus } = state;
  const project = entries.find((item) => item.id === todayProjectId);
  const date = localDateKey();
  if (!project) return <NothingYet eyebrow="NOTHING TO REVIEW" title="Review" heading="No focus chosen for today"
    body="Once you have captured something and picked it as today’s focus, you can check in on how it went."
    action="Go to your Inbox" onAction={() => router.navigate('/inbox')} />;
  // Keyed by day as well as project, so a form left open across midnight does not belong to
  // yesterday's check-in any more.
  return <ReviewScreen key={`${project.id}:${date}`} project={project} date={date} checkIn={getCheckIn(state, project.id, date)}
    buildProposal={(options) => replanProposal(state, options)}
    save={state.saveCheckIn} persistenceStatus={persistenceStatus}
    // Adopting a rolled-forward week has to move the availability with it, or the plan would sit
    // on dates the availability window no longer covers.
    onAcceptProposal={(plan, window) => { state.acceptPlan(plan); state.setAvailability(window); }} />;
}
export function WeekRoute() {
  const router = useRouter();
  const state = usePrototype();
  return <WeekScreen summary={weekSummary(state, dashboardWeek(state, localDateKey()))} onOpenPlan={() => router.navigate('/plan')} />;
}
export function SettingsRoute() {
  const router = useRouter();
  const state = usePrototype();
  return <SettingsScreen reminders={state.reminders} status={state.notificationStatus} onChange={state.setReminders}
    onRequestPermission={state.requestNotificationPermission} onSendTest={state.sendTestNotification} onClose={() => router.back()} />;
}

export function AppHeader() {
  const router = useRouter();
  return <View style={styles.topBar}>
    <View style={styles.brandMark}><Text style={styles.brandIcon}>✳</Text></View>
    <View style={{ flex: 1 }}><Text style={styles.brand}>{APP_NAME}</Text><Text style={styles.brandSub}>{APP_TAGLINE}</Text></View>
    <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Reminders and settings" hitSlop={10} style={styles.avatar}><Text style={styles.avatarText}>⚙</Text></Pressable>
  </View>;
}

/**
 * Follows the phone's "remove animations" setting, and updates live if it changes mid-session.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => setReduced(value));
    return () => { active = false; subscription?.remove?.(); };
  }, []);
  return reduced;
}

/**
 * A short fade-and-rise for things that appear in place. When motion is reduced it jumps
 * straight to the end state rather than animating quickly.
 *
 * Only things that arrive *because of something you did* are wrapped in this — never the
 * standing contents of a screen, which should not move under you.
 */
function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const duration = motionDuration(reduced, MOTION.normal);
    if (duration === 0) { progress.setValue(1); return; }
    Animated.timing(progress, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress, reduced, delay]);
  return <Animated.View style={{
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [motionOffset(reduced), 0] }) }],
  }}>{children}</Animated.View>;
}

function Page({ children }: { children: React.ReactNode }) {
  return <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}
function Eyebrow({ children }: { children: React.ReactNode }) { return <Text style={styles.eyebrow}>{children}</Text>; }
function Title({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return <View style={styles.titleBlock}><Text style={styles.title}>{children}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>;
}
function Pill({ children, tone = 'green' }: { children: React.ReactNode; tone?: 'green' | 'yellow' | 'blue' | 'orange' }) {
  const bg = tone === 'yellow' ? styles.pillYellow : tone === 'blue' ? styles.pillBlue : tone === 'orange' ? styles.pillOrange : styles.pillGreen;
  const fg = tone === 'yellow' ? styles.pillTextYellow : tone === 'blue' ? styles.pillTextBlue : tone === 'orange' ? styles.pillTextOrange : styles.pillTextGreen;
  return <View style={[styles.pill, bg]}><Text style={[styles.pillText, fg]}>{children}</Text></View>;
}
function Card({ children, style }: { children: React.ReactNode; style?: object }) { return <View style={[styles.card, style]}>{children}</View>; }
function Field({ label, value, onChangeText, placeholder, multiline = false, compact = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; compact?: boolean }) {
  return <View style={compact ? styles.fieldCompact : styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#9AA29C" multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} style={[styles.fieldInput, multiline && styles.fieldMultiline, compact && styles.fieldInputCompact]} />
  </View>;
}
function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.primaryButtonDisabled]}><Text style={styles.primaryButtonText}>{label}</Text><Text style={styles.primaryButtonArrow}>→</Text></Pressable>;
}
function toggleModeValue(selected: WorkMode[], value: WorkMode): WorkMode[] {
  return selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
}

function dateLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function PlanScreen(state: PrototypeState) {
  const { entries, availability, setAvailability, selectedProjectIds, setSelectedProjectIds, acceptedPlan, acceptPlan, updatePlanDay } = state;
  const [draft, setDraft] = useState<DraftPlan | null>(null);
  const [selectedDay, setSelectedDay] = useState<PlannedDay | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupText, setBackupText] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const projects = entries.filter((item) => !item.parentId && item.kind !== 'Idea');
  const includedProjects = projects.filter((item) => selectedProjectIds.includes(item.id)).map(plannerProject);
  const visiblePlan = draft ?? acceptedPlan;
  const assignedCount = visiblePlan?.days.filter((day) => day.projectId).length ?? 0;
  const selectedDayProject = selectedDay ? resolveProjectReference(entries, selectedDay.projectId) : { kind: 'open' as const };

  const updateAvailability = (date: string, change: Partial<DayAvailability>) => {
    const nextDays = availability.map((day) => day.date === date ? { ...day, ...change } : day);
    setAvailability(nextDays);
    if (draft) setDraft(createDraftPlan(includedProjects, nextDays, draft.days));
  };
  const toggleProject = (id: string) => {
    const nextIds = selectedProjectIds.includes(id) ? selectedProjectIds.filter((item) => item !== id) : [...selectedProjectIds, id];
    setSelectedProjectIds(nextIds);
    if (draft) setDraft(createDraftPlan(projects.filter((item) => nextIds.includes(item.id)).map(plannerProject), availability, draft.days));
  };
  const generateDraft = () => setDraft(createDraftPlan(includedProjects, availability, draft?.days ?? acceptedPlan?.days ?? []));
  const editDraftDay = (date: string, projectId: string | null) => {
    if (!draft) return;
    const days = assignProjectToDay(draft.days, date, projectId, projects.map(plannerProject));
    setDraft({ ...draft, days, risks: evaluatePlanRisks(candidatesForDays(projects, selectedProjectIds, days), days) });
    if (projectId && !selectedProjectIds.includes(projectId)) setSelectedProjectIds([...selectedProjectIds, projectId]);
  };
  const changeLock = (day: PlannedDay) => {
    const next = { ...day, locked: !day.locked };
    if (draft) setDraft({ ...draft, days: draft.days.map((item) => item.date === day.date ? next : item) });
    else updatePlanDay(next);
    setSelectedDay(next);
  };
  const confirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    if (draft) {
      const days = clearProjectFromDays(draft.days, id);
      const remaining = projects.filter((item) => item.id !== id);
      const stillSelected = selectedProjectIds.filter((item) => item !== id);
      setDraft({ ...draft, days, risks: evaluatePlanRisks(candidatesForDays(remaining, stillSelected, days), days) });
    }
    state.removeEntry(id);
    setPendingDelete(null);
  };
  const exportBackup = () => {
    setBackupText(serializeBackup(toAppData(state), new Date().toISOString()));
    setBackupMessage('Backup ready. Select and copy the JSON to save it somewhere safe.');
  };
  const restoreBackup = () => {
    const result = parseBackup(backupText);
    if (!result.ok) {
      setBackupMessage(result.reason);
      return;
    }
    state.restoreData(result.data);
    setBackupMessage('Backup restored on this device.');
  };

  return <>
    <Page>
      <Eyebrow>ONE MAIN PROJECT PER DAY</Eyebrow>
      <Title subtitle="Choose when you can work. Review and edit the draft before accepting it.">Plan your days</Title>
      {!state.hydrated ? <Text style={styles.captureHint}>Loading your saved plan…</Text> : null}
      {state.loadProblem ? <Card style={styles.loadProblemCard}>
        <Text style={styles.loadProblemTitle}>Saved data could not be read</Text>
        <Text style={styles.loadProblemText}>{state.loadProblem} Nothing on this device has been overwritten. Your changes will not be saved until you restore a valid backup below or start fresh.</Text>
        <Pressable onPress={state.startFresh} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Start fresh and save from now on</Text></Pressable>
      </Card> : null}
      <Card style={styles.planNote}><View style={styles.planNoteIcon}><Text>✳</Text></View><Text style={styles.planNoteText}>A focus session uses the time you set for that day. Inbox items are only considered after you include them here.</Text></Card>

      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>When can you work?</Text><Text style={styles.count}>NEXT 7 DAYS</Text></View>
      <Pressable onPress={() => setAvailability(makeAvailability(nextMonday()))} style={styles.weekReset}><Text style={styles.weekResetText}>Set dates to next Monday–Sunday</Text></Pressable>
      {availability.map((day) => <View key={day.date} style={styles.availabilityRow}>
        <Pressable onPress={() => updateAvailability(day.date, { available: !day.available })} style={[styles.availabilityDay, day.available && styles.availabilityDayActive]}>
          <Text style={[styles.availabilityName, day.available && styles.availabilityNameActive]}>{dateLabel(day.date)}</Text>
          <Text style={styles.availabilityToggle}>{day.available ? 'Available' : 'Off'}</Text>
        </Pressable>
        <Pressable disabled={!day.available} onPress={() => updateAvailability(day.date, { minutes: day.minutes >= 240 ? 30 : day.minutes + 30 })} style={styles.timeButton}>
          <Text style={styles.timeButtonText}>{day.available ? `${day.minutes} min` : '—'}</Text>
          {day.available ? <Text style={styles.timeHint}>tap to change</Text> : null}
        </Pressable>
      </View>)}
      <Text style={styles.captureHint}>Tap an available day to turn it off. Tap its time to add 30 minutes, up to 4 hours.</Text>

      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Projects for this draft</Text><Text style={styles.count}>{includedProjects.length} SELECTED</Text></View>
      {projects.length === 0
        ? <Card><Text style={styles.safePlanTitle}>Nothing to plan yet</Text><Text style={styles.safePlanText}>Capture something in your Inbox first, then come back and choose which days to work on it.</Text></Card>
        : <Text style={styles.captureHint}>Add only projects you want considered now. An Inbox item stays unscheduled until you include and accept it.</Text>}
      {projects.map((entry) => {
        const selected = selectedProjectIds.includes(entry.id);
        const data = plannerProject(entry);
        return <View key={entry.id} style={styles.projectChoice}>
          <Pressable onPress={() => toggleProject(entry.id)} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Include ${entry.title} in this draft`} style={styles.projectChoiceMain}>
            <View style={[styles.checkbox, selected && styles.checkboxSelected]}>{selected ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
            <View style={{ flex: 1 }}><Text style={styles.projectChoiceTitle}>{entry.title}</Text><Text style={styles.projectChoiceContext}>{entry.appName}</Text><Text style={styles.projectChoiceMeta}>{data.remainingSessions} focus {data.remainingSessions === 1 ? 'day' : 'days'} · {data.priority} priority{data.deadline ? ` · due ${dateLabel(data.deadline)}` : ''}{entry.state === 'inbox' ? ' · Inbox' : ''}</Text></View>
          </Pressable>
          <Pressable onPress={() => setPendingDelete(entry)} accessibilityRole="button" accessibilityLabel={`Remove ${entry.title}`} hitSlop={10} style={styles.deleteProjectButton}><Text style={styles.deleteProjectText}>×</Text></Pressable>
        </View>;
      })}
      <PrimaryButton label="Create a draft plan" onPress={generateDraft} disabled={!includedProjects.length || !availability.some((day) => day.available && day.minutes > 0)} />

      {visiblePlan ? <>
        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{draft ? 'Review this draft' : 'Accepted plan'}</Text><Text style={styles.count}>{assignedCount} FOCUS DAYS</Text></View>
        <Text style={styles.captureHint}>{draft ? 'Tap any day to change its project or lock it. Accept only when this plan looks right.' : 'Your accepted plan is saved on this device. Tap a day to edit or lock it.'}</Text>
        {visiblePlan.days.map((day, dayIndex) => {
          const reference = resolveProjectReference(entries, day.projectId);
          const item = reference.kind === 'assigned' ? reference.project : undefined;
          const sessionNumber = day.projectId ? visiblePlan.days.slice(0, dayIndex + 1).filter((candidate) => candidate.projectId === day.projectId).length : 0;
          const sessionCount = item ? Math.max(plannerProject(item).remainingSessions, visiblePlan.days.filter((candidate) => candidate.projectId === day.projectId).length) : 0;
          return <Pressable key={day.date} onPress={() => setSelectedDay(day)} style={styles.plannedDayCard}>
            <View style={styles.dayCardTop}><Text style={styles.plannedDate}>{dateLabel(day.date)}</Text><View style={styles.dayBadges}>{day.locked ? <Pill tone="blue">LOCKED</Pill> : null}{day.projectId ? <Pill tone={day.available ? 'green' : 'orange'}>{day.available ? `${day.minutes} MIN` : 'UNAVAILABLE'}</Pill> : <Pill tone="blue">{day.available ? 'OPEN' : 'OFF'}</Pill>}</View></View>
            <Text style={styles.plannedProjectName}>{item?.title ?? (reference.kind === 'missing' ? 'Saved project is missing' : day.available ? 'Leave this day open' : 'Unavailable')}</Text>
            {item ? <><Text style={styles.dayContext}>{item.appName} · FOCUS SESSION {sessionNumber} OF {sessionCount}</Text><Text style={styles.dayDescription}>{item.todayGoal || item.outcome || 'Add a clear outcome in Inbox.'}</Text><Text style={styles.dayWhy}>{day.reason}</Text></> : null}
            {reference.kind === 'missing' ? <><Text style={styles.dayContext}>This day still points to a project that is not in your Inbox.</Text><Text style={styles.dayDescription}>Saved ID: {reference.projectId}</Text><Text style={styles.dayWhy}>This assignment is kept. Tap to choose a replacement or leave the day open.</Text></> : null}
            <Text style={styles.tapHint}>TAP TO REVIEW OR EDIT</Text>
          </Pressable>;
        })}
        {visiblePlan.risks.length ? <>
          <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Work at risk</Text><Text style={styles.count}>{visiblePlan.risks.length} ITEMS</Text></View>
          {visiblePlan.risks.map((risk) => <Card key={risk.projectId} style={styles.riskCard}><View style={styles.riskIcon}><Text style={styles.riskIconText}>!</Text></View><View style={{ flex: 1 }}><Text style={styles.riskTitle}>{risk.title}</Text><Text style={styles.riskBody}>{risk.message}</Text><Text style={styles.riskBody}>Choices: add an available day above, update the estimate or deadline in Inbox, or leave these sessions unplanned.</Text></View></Card>)}
        </> : <Card style={styles.safePlan}><Text style={styles.safePlanTitle}>All selected work fits</Text><Text style={styles.safePlanText}>There is at most one main project on each available day, and no selected sessions are left out.</Text></Card>}
        {draft ? <PrimaryButton label={visiblePlan.risks.length ? 'Accept partial plan · keep risks visible' : 'Accept this plan'} onPress={() => { acceptPlan(draft); setDraft(null); }} /> : <Pressable onPress={generateDraft} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Make a new draft</Text></Pressable>}
      </> : null}
      <Pressable onPress={() => { setBackupOpen(true); setBackupMessage(''); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Export or restore a backup</Text></Pressable>
    </Page>
    <Modal visible={selectedDay !== null} transparent animationType="slide" onRequestClose={() => setSelectedDay(null)}>
      <View style={styles.modalBackdrop}><Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedDay(null)} /><View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        {selectedDay ? <ScrollView keyboardShouldPersistTaps="handled">
          <View style={styles.modalHeader}><Eyebrow>{dateLabel(selectedDay.date).toUpperCase()}</Eyebrow><Pressable onPress={() => setSelectedDay(null)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
          <Text style={styles.modalTitle}>{selectedDayProject.kind === 'assigned' ? selectedDayProject.project.title : selectedDayProject.kind === 'missing' ? 'Saved project not found' : selectedDay.available ? 'Open day' : 'Unavailable'}</Text>
          <Text style={styles.modalContext}>{selectedDayProject.kind === 'assigned' ? selectedDayProject.project.appName : selectedDayProject.kind === 'missing' ? `This day’s saved project ID is ${selectedDayProject.projectId}` : `${selectedDay.minutes} minutes available`}</Text>
          {selectedDayProject.kind === 'assigned' ? <><Text style={styles.modalSectionLabel}>INTENDED OUTCOME</Text><Text style={styles.modalBody}>{selectedDayProject.project.todayGoal || selectedDayProject.project.outcome || 'Add an outcome in Inbox.'}</Text><Text style={styles.modalSectionLabel}>WHY THIS DAY</Text><Text style={styles.modalBody}>{selectedDay.reason || 'You can set the reason in the project details.'}</Text>{selectedDayProject.project.firstStep ? <><Text style={styles.modalSectionLabel}>SUGGESTED NEXT STEP</Text><Text style={styles.modalBody}>{selectedDayProject.project.firstStep}</Text></> : null}</> : null}
          {selectedDayProject.kind === 'missing' ? <><Text style={styles.modalSectionLabel}>WHAT HAPPENED</Text><Text style={styles.modalBody}>The saved plan refers to a project that is no longer in your Inbox. The day and its saved project ID are still preserved. Choose a project below to replace it, or leave this day open.</Text></> : null}
          <Text style={styles.modalSectionLabel}>CHANGE THIS DAY’S PROJECT</Text>
          {(selectedDay.available ? [{ id: null, title: 'Leave this day open' }, ...projects.map((item) => ({ id: item.id, title: item.title }))] : [{ id: null, title: 'This day is unavailable. Turn it on above to schedule work.' }]).map((choice) => <Pressable key={choice.id ?? 'open'} onPress={() => { if (draft) editDraftDay(selectedDay.date, choice.id); else if (acceptedPlan && selectedDay.available) updatePlanDay(assignProjectToDay(acceptedPlan.days, selectedDay.date, choice.id, projects.map(plannerProject)).find((day) => day.date === selectedDay.date)!); setSelectedDay(null); }} style={styles.choiceButton}><Text style={styles.choiceButtonText}>{choice.title}</Text>{selectedDay.projectId === choice.id ? <Text style={styles.choiceSelected}>Selected</Text> : null}</Pressable>)}
          <Pressable onPress={() => changeLock(selectedDay)} style={styles.lockButton}><Text style={styles.lockButtonText}>{selectedDay.locked ? 'Unlock this day for future drafts' : 'Lock this day in future drafts'}</Text></Pressable>
          <Text style={styles.captureHint}>Locked days stay as set when you make another draft. Unlock a day if you want the planner to move it.</Text>
        </ScrollView> : null}
      </View></View>
    </Modal>
    <Modal visible={backupOpen} transparent animationType="slide" onRequestClose={() => setBackupOpen(false)}>
      <View style={styles.modalBackdrop}><Pressable style={StyleSheet.absoluteFill} onPress={() => setBackupOpen(false)} /><View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}><Eyebrow>VERSIONED DEVICE BACKUP</Eyebrow><Pressable onPress={() => setBackupOpen(false)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
        <Text style={styles.modalTitle}>Export or restore</Text>
        <Text style={styles.modalBody}>Your backup is JSON version 1. Export it and save a copy elsewhere. To restore, paste a backup below and choose Restore. Restoring replaces this device’s current data.</Text>
        <View style={styles.modeRow}><Pressable onPress={exportBackup} style={styles.modeButton}><Text style={styles.modeText}>Create backup</Text></Pressable><Pressable onPress={restoreBackup} style={styles.modeButton}><Text style={styles.modeText}>Restore pasted backup</Text></Pressable></View>
        <TextInput multiline value={backupText} onChangeText={setBackupText} selectTextOnFocus placeholder="Exported backup appears here. Paste a saved backup here to restore." placeholderTextColor="#9AA29C" style={[styles.fieldInput, styles.backupInput]} />
        {backupMessage ? <Text style={styles.savedHint}>{backupMessage}</Text> : null}
      </View></View>
    </Modal>
    <Modal visible={pendingDelete !== null} transparent animationType="slide" onRequestClose={() => setPendingDelete(null)}>
      <View style={styles.modalBackdrop}><Pressable style={StyleSheet.absoluteFill} onPress={() => setPendingDelete(null)} /><View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}><Eyebrow>REMOVE FROM YOUR LIST</Eyebrow><Pressable onPress={() => setPendingDelete(null)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
        <Text style={styles.modalTitle}>{pendingDelete?.title}</Text>
        <Text style={styles.modalBody}>This removes the project from your list and from this draft. Any focus day it was holding goes back to open, and it stops being today’s focus if it was. Removing it cannot be undone.</Text>
        <Pressable onPress={confirmDelete} style={styles.dangerButton}><Text style={styles.dangerButtonText}>Remove this project</Text></Pressable>
        <Pressable onPress={() => setPendingDelete(null)} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Keep it</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}

function TodayScreen({ entry, checkIn, actionProgress, persistenceStatus, onActionDone, onSaveAction, onDoneForToday, onContinue, onReview }: {
  entry: Entry;
  checkIn: CheckIn | null;
  actionProgress: ReturnType<typeof getTodayActionProgress>;
  persistenceStatus: 'loading' | 'saving' | 'saved' | 'error';
  onActionDone: () => void;
  onSaveAction: (action: string) => void;
  onDoneForToday: () => void;
  onContinue: () => void;
  onReview: () => void;
}) {
  const [actionDraft, setActionDraft] = useState('');
  const goal = entry.todayGoal || (entry.outcome ? `Choose one small step toward: ${entry.outcome}. Edit today’s goal in Inbox if you want to be more specific.` : 'Add a plain-language goal in the project details before you begin.');
  const reason = entry.todayReason || 'You chose this project for today. This focus uses the details you entered.';


  const workLabel = entry.workModes.length ? entry.workModes.join(' + ') : 'Choose a work type in Inbox';
  const saveAction = () => {
    if (!actionDraft.trim()) return;
    onSaveAction(actionDraft);
    setActionDraft('');
  };
  return <Page>
    <Eyebrow>{dateLabel(actionProgress.date).toUpperCase()}</Eyebrow>
    <Title subtitle="One project. One clear next step.">{greeting(new Date().getHours())}</Title>
    {checkIn ? <View style={styles.checkedBanner}><Text style={styles.checkedIcon}>✓</Text><View style={{ flex: 1 }}><Text style={styles.checkedTitle}>Checked in — {checkIn.status.toLowerCase()}</Text><Text style={styles.checkedCaption}>{persistenceStatus === 'error' ? 'Could not save on this device.' : persistenceStatus === 'saved' ? 'Saved on this device' : 'Saving to this device…'}</Text></View></View> : null}
    <View style={styles.heroCard}>
      <View style={styles.heroTop}><Pill>ONE MAIN PROJECT</Pill><Text style={styles.heroSpark}>✳</Text></View>
      <Text style={styles.projectContext}>{entry.appName}</Text>
      <Text style={styles.heroTitle}>{entry.title}</Text>
      <Text style={styles.heroDescription}>{entry.outcome || entry.description || 'Use the details you captured to choose one useful outcome.'}</Text>
      <View style={styles.heroDivider} />
      <Text style={styles.heroLabel}>WHY THIS IS TODAY’S FOCUS</Text>
      <Text style={styles.heroReason}>{reason}</Text>
    </View>
    <View style={styles.workTypeRow}><Text style={styles.workTypeLabel}>TODAY’S WORK</Text><Pill tone={entry.workModes.length ? 'green' : 'yellow'}>{workLabel.toUpperCase()}</Pill></View>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Do this today</Text></View>
    <Card style={styles.goalCard}>
      <View style={styles.goalNumber}><Text style={styles.goalCheckText}>1</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.goalTitle}>Today: {goal}</Text>{!entry.todayGoal ? <Text style={styles.goalDescription}>Suggested from your description. Edit this in Inbox if it doesn’t fit.</Text> : null}</View>
    </Card>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>First action</Text>{actionProgress.doneForToday ? <Pill tone="blue">DONE FOR TODAY</Pill> : actionProgress.currentAction ? <Pill>IN PROGRESS</Pill> : <Pill tone="yellow">ADD AN ACTION</Pill>}</View>
    {actionProgress.completedActions.map((action, index) => <FadeIn key={`${index}-${action}`} delay={index * 40}><Card style={styles.completedActionCard}><Text style={styles.completedActionCheck}>✓</Text><View style={{ flex: 1 }}><Text style={styles.completedActionLabel}>ACTION {index + 1} · DONE</Text><Text style={styles.completedActionText}>{action}</Text></View></Card></FadeIn>)}
    {actionProgress.doneForToday ? <>
      <Card style={styles.safePlan}><Text style={styles.safePlanTitle}>Done for today</Text><Text style={styles.safePlanText}>{entry.title} remains your focus. Your completed actions are saved; the project and day are not marked complete.{actionProgress.currentAction ? ` Next action, when you continue: ${actionProgress.currentAction}` : ''}</Text></Card>
      <Pressable onPress={onContinue} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Continue with another action in {entry.title}</Text><Text style={styles.buttonArrow}>→</Text></Pressable>
    </> : actionProgress.currentAction ? <>
      <Card style={styles.stepCard}>
        <View style={styles.stepIcon}><Text style={styles.stepIconText}>→</Text></View>
        <View style={{ flex: 1 }}><Text style={styles.stepLabel}>IN {entry.title}</Text><Text style={styles.stepText}>{actionProgress.currentAction}</Text></View>
      </Card>
      <PrimaryButton label="Mark this action done" onPress={onActionDone} />
      {actionProgress.completedActions.length ? <Pressable onPress={onDoneForToday} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Done for today</Text></Pressable> : null}
      <Text style={styles.captureHint}>This completes only this action. {entry.title} stays your focus for today.</Text>
    </> : <>
      <Text style={styles.captureHint}>{actionProgress.completedActions.length ? `Add another action for ${entry.title}, or stop for today.` : `No first action is saved for ${entry.title}. Add the action you want to take; the app will not make one up.`}</Text>
      <Field label={actionProgress.completedActions.length ? 'NEXT ACTION · SAME PROJECT' : 'FIRST ACTION · SAME PROJECT'} value={actionDraft} onChangeText={setActionDraft} placeholder="Write the action you want to take" multiline />
      <PrimaryButton label={actionProgress.completedActions.length ? 'Save next action' : 'Save first action'} onPress={saveAction} disabled={!actionDraft.trim()} />
      {actionProgress.completedActions.length ? <Pressable onPress={onDoneForToday} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Done for today</Text></Pressable> : null}
    </>}
    <Text style={persistenceStatus === 'saved' ? styles.savedHint : styles.captureHint}>{persistenceStatus === 'saved' ? 'Today’s action progress is saved on this device.' : persistenceStatus === 'error' ? 'Action progress could not be saved. Keep the app open and check storage before closing.' : persistenceStatus === 'saving' ? 'Saving action progress on this device…' : 'Loading saved action progress…'}</Text>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Where this fits</Text></View>
    <Card style={styles.journeyCard}>
      <Text style={styles.journeyCaption}>HOW THIS FITS THE BIGGER GOAL</Text>
      <Text style={styles.journeyStep}>{entry.outcome || entry.description || 'Add a desired outcome in Inbox details.'}</Text>
      <Text style={styles.todaySlice}>Today’s work is one step toward this result.</Text>
    </Card>
    <View style={styles.stuckCard}>
      <Text style={styles.stuckTitle}>If you get stuck</Text>
      <Text style={styles.stuckText}>{entry.blocker ? `You wrote: “${entry.blocker}” If you get stuck, note what you expected, what happened, and what you need to find out next.` : 'Write down what you expected, what happened, and what you need to find out next. That can be today’s next step.'}</Text>
    </View>
    <Pressable onPress={onReview} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Check in on today</Text><Text style={styles.buttonArrow}>→</Text></Pressable>
  </Page>;
}

function InboxScreen({ entries, addEntry, updateEntry, todayProjectId, chooseTodayProject }: { entries: Entry[]; addEntry: (entry: Omit<Entry, 'id'>) => void; updateEntry: (entry: Entry) => void; todayProjectId: string; chooseTodayProject: (id: string) => void }) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [kind, setKind] = useState<Kind>('Coding');
  const [workModes, setWorkModes] = useState<WorkMode[]>([]);
  const [title, setTitle] = useState('');
  const [appName, setAppName] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [todayGoal, setTodayGoal] = useState('');
  const [firstStep, setFirstStep] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [todayReason, setTodayReason] = useState('');
  const [done, setDone] = useState('');
  const [remaining, setRemaining] = useState('');
  const [blocker, setBlocker] = useState('');
  const [deadline, setDeadline] = useState('');
  const [remainingSessions, setRemainingSessions] = useState('1');
  const [priority, setPriority] = useState<Priority>('normal');
  const [showMore, setShowMore] = useState(false);
  const [existingId, setExistingId] = useState('');
  const [opened, setOpened] = useState<Entry | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<Entry | null>(null);
  const planned = entries.filter((item) => item.state === 'planned' && !item.parentId);
  const unscheduled = entries.filter((item) => item.state === 'inbox' && !item.parentId);
  const linkedNotes = entries.filter((item) => item.parentId);
  const projects = entries.filter((item) => item.state === 'planned' && !item.parentId);
  const clearForm = () => { setTitle(''); setAppName(''); setDescription(''); setOutcome(''); setTodayGoal(''); setFirstStep(''); setNextStep(''); setTodayReason(''); setDone(''); setRemaining(''); setBlocker(''); setDeadline(''); setRemainingSessions('1'); setPriority('normal'); setWorkModes([]); setShowMore(false); };
  const submit = () => {
    if (!title.trim()) return;
    const parent = mode === 'existing' ? entries.find((entry) => entry.id === existingId) : undefined;
    addEntry({ title: title.trim(), appName: mode === 'new' ? appName.trim() : parent?.appName ?? '', kind, workModes, description: description.trim(), outcome: outcome.trim(), todayGoal: todayGoal.trim(), firstStep: firstStep.trim(), nextStep: nextStep.trim(), todayReason: todayReason.trim(), done: done.trim(), remaining: remaining.trim(), blocker: blocker.trim(), deadline: deadline.trim(), remainingSessions: Math.max(1, Number(remainingSessions) || 1), priority, state: 'inbox', ...(parent ? { parentId: parent.id } : {}) });
    clearForm();
  };
  const openEntry = (entry: Entry) => { setOpened(entry); setEditDraft({ ...entry }); setEditing(false); };
  const saveEdit = () => { if (editDraft) updateEntry(editDraft); setOpened(editDraft); setEditing(false); };
  const toggleWorkMode = (value: WorkMode, selected: WorkMode[], setSelected: (next: WorkMode[]) => void) => setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  const parentOf = (entry: Entry) => entries.find((item) => item.id === entry.parentId);
  const renderEntry = (entry: Entry, isPlanned: boolean) => <Pressable key={entry.id} onPress={() => openEntry(entry)} style={styles.inboxItem}>
    <View style={styles.inboxItemTop}><Text style={styles.itemName}>{entry.title}</Text><Pill tone={isPlanned ? 'yellow' : entry.kind === 'Idea' ? 'blue' : 'orange'}>{isPlanned ? 'PLANNED' : entry.kind === 'Idea' ? 'IDEA · INBOX' : 'UNSCHEDULED'}</Pill></View>
    <Text style={styles.itemContext}>{entry.appName || 'New commitment'}</Text>
    <Text style={styles.itemDetail} numberOfLines={2}>{entry.description || entry.outcome || 'No description yet. Tap to add context.'}</Text>
    {entry.deadline && entry.deadline !== 'No deadline set' ? <Text style={styles.itemDeadline}>DUE · {entry.deadline}</Text> : null}
    <View style={styles.itemMeta}><Text style={styles.itemKind}>{entry.kind.toUpperCase()}</Text><Text style={styles.itemUnscheduled}>{parentOf(entry) ? `ADDED TO ${parentOf(entry)?.title.toUpperCase()}` : 'TAP TO READ OR EDIT'}</Text></View>
  </Pressable>;
  const kinds: Kind[] = ['Coding', 'Assignment', 'Course', 'Idea'];
  const workOptions: WorkMode[] = ['Planning', 'Learning', 'Debugging', 'Coding', 'Writing', 'Other'];

  return <>
    <Page>
      <Eyebrow>CAPTURE WITHOUT COMMITTING TO A DATE</Eyebrow>
      <Title subtitle="Write the thought down in your own words. Details can wait until you have time.">Your Inbox</Title>
      <Card style={styles.captureCard}>
        <Text style={styles.captureLabel}>WHAT ARE YOU ADDING?</Text>
        <View style={styles.modeRow}>
          <Pressable onPress={() => setMode('new')} style={[styles.modeButton, mode === 'new' && styles.modeButtonActive]}><Text style={[styles.modeText, mode === 'new' && styles.modeTextActive]}>New project / commitment</Text></Pressable>
          {projects.length ? <Pressable onPress={() => setMode('existing')} style={[styles.modeButton, mode === 'existing' && styles.modeButtonActive]}><Text style={[styles.modeText, mode === 'existing' && styles.modeTextActive]}>To an existing project</Text></Pressable> : null}
        </View>
        {mode === 'new' ? <>
          <Text style={styles.fieldLabel}>TYPE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>{kinds.map((value) => <Pressable key={value} onPress={() => setKind(value)} style={[styles.kindChip, kind === value && styles.kindChipActive]}><Text style={[styles.kindChipText, kind === value && styles.kindChipTextActive]}>{value}</Text></Pressable>)}</ScrollView>
          <Field label="NAME" value={title} onChangeText={setTitle} placeholder="A short name you’ll recognize" />
          {kind !== 'Idea' ? <Field label="APP / PROJECT / COURSE (OPTIONAL)" value={appName} onChangeText={setAppName} placeholder="Which app or commitment is this for?" /> : null}
        </> : <>
          <Text style={styles.fieldLabel}>CHOOSE THE PROJECT</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>{projects.map((project) => <Pressable key={project.id} onPress={() => setExistingId(project.id)} style={[styles.kindChip, existingId === project.id && styles.kindChipActive]}><Text style={[styles.kindChipText, existingId === project.id && styles.kindChipTextActive]}>{project.appName.split('·')[0].trim()}</Text></Pressable>)}</ScrollView>
          <Field label="THOUGHT, TASK, OR BLOCKER" value={title} onChangeText={setTitle} placeholder="What do you want to add?" />
        </>}
        <Field label="DESCRIBE IT IN YOUR OWN WORDS (OPTIONAL)" value={description} onChangeText={setDescription} placeholder="What’s on your mind? Add as much or as little context as you like." multiline />
        <Pressable onPress={() => setShowMore((value) => !value)} style={styles.moreToggle}><Text style={styles.moreToggleText}>{showMore ? '− Hide extra details' : '+ Add outcome, progress, blocker, or deadline'}</Text></Pressable>
        {showMore ? <View style={styles.extraFields}>
          <Text style={styles.fieldLabel}>WHAT KIND OF WORK IS THIS? SELECT ALL THAT FIT</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>{workOptions.map((value) => <Pressable key={value} onPress={() => toggleWorkMode(value, workModes, setWorkModes)} style={[styles.kindChip, workModes.includes(value) && styles.kindChipActive]}><Text style={[styles.kindChipText, workModes.includes(value) && styles.kindChipTextActive]}>{value}</Text></Pressable>)}</ScrollView>
          <Field compact label="ESTIMATED FOCUS DAYS / SESSIONS LEFT" value={remainingSessions} onChangeText={setRemainingSessions} placeholder="e.g. 2" />
          <Text style={[styles.fieldLabel, { marginTop: 10 }]}>PRIORITY</Text>
          <View style={styles.editModeRow}>{(['low', 'normal', 'high', 'urgent'] as Priority[]).map((value) => <Pressable key={value} onPress={() => setPriority(value)} style={[styles.kindChip, priority === value && styles.kindChipActive]}><Text style={[styles.kindChipText, priority === value && styles.kindChipTextActive]}>{value}</Text></Pressable>)}</View>
          <Field compact label="WHAT DO YOU WANT TO ACHIEVE?" value={outcome} onChangeText={setOutcome} placeholder="The result you hope for" multiline />
          <Field compact label="WHAT WOULD BE USEFUL PROGRESS TODAY?" value={todayGoal} onChangeText={setTodayGoal} placeholder="Optional · use plain language" multiline />
          <Field compact label="A FIRST STEP YOU CAN UNDERSTAND" value={firstStep} onChangeText={setFirstStep} placeholder="Optional · no code file names needed" multiline />
          <Field compact label="ANOTHER ACTION (OPTIONAL)" value={nextStep} onChangeText={setNextStep} placeholder="Shown after you mark the first action done" multiline />
          <Field compact label="WHY DOES THIS FIT TODAY?" value={todayReason} onChangeText={setTodayReason} placeholder="Optional context for the focus" multiline />
          <Field compact label="WHAT HAVE YOU ALREADY DONE?" value={done} onChangeText={setDone} placeholder="Optional" multiline />
          <Field compact label="WHAT IS LEFT?" value={remaining} onChangeText={setRemaining} placeholder="Optional" multiline />
          <Field compact label="WHAT CONFUSES OR BLOCKS YOU?" value={blocker} onChangeText={setBlocker} placeholder="Optional" multiline />
          <Field compact label="DEADLINE (OPTIONAL)" value={deadline} onChangeText={setDeadline} placeholder="YYYY-MM-DD, e.g. 2026-10-09" />
        </View> : null}
        <PrimaryButton label={mode === 'new' ? 'Add to Inbox · stays unscheduled' : 'Add note to this project'} onPress={submit} disabled={!title.trim()} />
        <Text style={styles.captureHint}>{mode === 'new' ? 'Nothing is planned just because you captured it.' : 'This adds a note to the selected project. It does not change the plan.'}</Text>
      </Card>
      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Already on your plan</Text><Text style={styles.count}>{planned.length} COMMITMENTS</Text></View>
      {planned.map((entry) => renderEntry(entry, true))}
      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Ideas & unscheduled</Text><Text style={styles.count}>{unscheduled.length} IN INBOX</Text></View>
      {unscheduled.length ? unscheduled.map((entry) => renderEntry(entry, false)) : <Text style={styles.emptyState}>Nothing waiting in the Inbox right now.</Text>}
      {linkedNotes.length ? <><View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Notes added to projects</Text><Text style={styles.count}>{linkedNotes.length} NOTES</Text></View>{linkedNotes.map((entry) => renderEntry(entry, false))}</> : null}
    </Page>
    <Modal visible={opened !== null} transparent animationType="slide" onRequestClose={() => setOpened(null)}>
      <View style={styles.modalBackdrop}><Pressable style={StyleSheet.absoluteFill} onPress={() => setOpened(null)} /><View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        {editDraft ? <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.modalHeader}><Eyebrow>{editDraft.state === 'planned' ? 'PLANNED COMMITMENT' : editDraft.parentId ? 'PROJECT NOTE' : editDraft.kind === 'Idea' ? 'UNSCHEDULED IDEA' : 'INBOX · UNSCHEDULED'}</Eyebrow><Pressable onPress={() => setOpened(null)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
          {editing ? <>
            <Field label="NAME" value={editDraft.title} onChangeText={(value) => setEditDraft({ ...editDraft, title: value })} placeholder="Name" />
            <Field label="APP / PROJECT / COURSE" value={editDraft.appName} onChangeText={(value) => setEditDraft({ ...editDraft, appName: value })} placeholder="Optional" />
            <Text style={[styles.fieldLabel, styles.editWorkLabel]}>TODAY’S WORK · SELECT ALL THAT FIT</Text>
            <View style={styles.editModeRow}>{workOptions.map((value) => <Pressable key={value} onPress={() => setEditDraft({ ...editDraft, workModes: toggleModeValue(editDraft.workModes, value) })} style={[styles.kindChip, editDraft.workModes.includes(value) && styles.kindChipActive]}><Text style={[styles.kindChipText, editDraft.workModes.includes(value) && styles.kindChipTextActive]}>{value}</Text></Pressable>)}</View>
            <Field label="ESTIMATED FOCUS DAYS / SESSIONS LEFT" value={String(editDraft.remainingSessions ?? plannerProject(editDraft).remainingSessions)} onChangeText={(value) => setEditDraft({ ...editDraft, remainingSessions: Math.max(1, Number(value) || 1) })} placeholder="e.g. 2" />
            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>PRIORITY</Text>
            <View style={styles.editModeRow}>{(['low', 'normal', 'high', 'urgent'] as Priority[]).map((value) => <Pressable key={value} onPress={() => setEditDraft({ ...editDraft, priority: value })} style={[styles.kindChip, (editDraft.priority ?? plannerProject(editDraft).priority) === value && styles.kindChipActive]}><Text style={[styles.kindChipText, (editDraft.priority ?? plannerProject(editDraft).priority) === value && styles.kindChipTextActive]}>{value}</Text></Pressable>)}</View>
            <Field label="DESCRIPTION" value={editDraft.description} onChangeText={(value) => setEditDraft({ ...editDraft, description: value })} placeholder="Your context" multiline />
            <Field label="DESIRED OUTCOME" value={editDraft.outcome} onChangeText={(value) => setEditDraft({ ...editDraft, outcome: value })} placeholder="What are you trying to achieve?" multiline />
            <Field label="USEFUL PROGRESS FOR TODAY" value={editDraft.todayGoal} onChangeText={(value) => setEditDraft({ ...editDraft, todayGoal: value })} placeholder="Optional; a specific, plain-language goal" multiline />
            <Field label="FIRST STEP" value={editDraft.firstStep} onChangeText={(value) => setEditDraft({ ...editDraft, firstStep: value })} placeholder="Optional; mark suggestions as suggestions" multiline />
            <Field label="ANOTHER ACTION (OPTIONAL)" value={editDraft.nextStep ?? ''} onChangeText={(value) => setEditDraft({ ...editDraft, nextStep: value })} placeholder="Shown after the first action is done" multiline />
            <Field label="WHY THIS PROJECT TODAY" value={editDraft.todayReason} onChangeText={(value) => setEditDraft({ ...editDraft, todayReason: value })} placeholder="Optional context" multiline />
            <Field label="ALREADY DONE" value={editDraft.done} onChangeText={(value) => setEditDraft({ ...editDraft, done: value })} placeholder="Optional" multiline />
            <Field label="WHAT IS LEFT" value={editDraft.remaining} onChangeText={(value) => setEditDraft({ ...editDraft, remaining: value })} placeholder="Optional" multiline />
            <Field label="CONFUSION / BLOCKER" value={editDraft.blocker} onChangeText={(value) => setEditDraft({ ...editDraft, blocker: value })} placeholder="Optional" multiline />
            <Field label="DEADLINE · YYYY-MM-DD" value={editDraft.deadline === 'No deadline set' ? '' : editDraft.deadline} onChangeText={(value) => setEditDraft({ ...editDraft, deadline: value })} placeholder="Optional · e.g. 2026-10-09" />
            <PrimaryButton label="Save item details" onPress={saveEdit} />
          </> : <>
            <Text style={styles.modalTitle}>{opened?.title}</Text>
            <Text style={styles.modalContext}>{opened?.appName || 'No app or project specified'}</Text>
            <Text style={styles.detailStatus}>{opened?.state === 'planned' ? 'On the sample plan' : opened?.parentId ? 'Added to an existing project · not scheduled separately' : 'In Inbox · not scheduled'}</Text>
            {[['YOUR DESCRIPTION', opened?.description], ['WHAT YOU WANT TO ACHIEVE', opened?.outcome], ['TODAY’S WORK', opened?.workModes.join(' + ')], ['FOCUS DAYS / SESSIONS LEFT', String(opened ? plannerProject(opened).remainingSessions : '')], ['PRIORITY', opened ? (opened.priority ?? plannerProject(opened).priority) : ''], ['USEFUL PROGRESS FOR TODAY', opened?.todayGoal], ['FIRST ACTION', opened?.firstStep], ['ANOTHER ACTION', opened?.nextStep], ['WHY THIS PROJECT TODAY', opened?.todayReason], ['ALREADY DONE', opened?.done], ['WHAT IS LEFT', opened?.remaining], ['WHAT CONFUSES OR BLOCKS YOU', opened?.blocker], ['DEADLINE', opened?.deadline && opened.deadline !== 'No deadline set' ? opened.deadline : '']].map(([label, value]) => value ? <View key={label} style={styles.detailSection}><Text style={styles.modalSectionLabel}>{label}</Text><Text style={styles.modalBody}>{value}</Text></View> : null)}
            {opened && !opened.parentId && opened.kind !== 'Idea' ? <Pressable onPress={() => { chooseTodayProject(opened.id); setOpened(null); }} style={styles.useTodayButton}><Text style={styles.useTodayButtonText}>{opened.id === todayProjectId ? 'This is already Today’s focus' : 'Set as Today’s focus'}</Text><Text style={styles.useTodayHint}>This changes today’s focus only. It does not change your accepted plan.</Text></Pressable> : null}
            <Pressable onPress={() => { setEditing(true); setEditDraft(opened ? { ...opened } : null); }} style={styles.editButton}><Text style={styles.editButtonText}>Edit full details</Text></Pressable>
          </>}
        </ScrollView> : null}
      </View></View>
    </Modal>
  </>;
}

function ReviewScreen({ project, date, checkIn, buildProposal, save, onAcceptProposal, persistenceStatus }: {
  project: Entry;
  date: string;
  checkIn: CheckIn | null;
  buildProposal: (options: { today: string; spentProjectId?: string; spentDay?: string }) => ReplanProposal | null;
  save: (checkIn: CheckIn) => void;
  onAcceptProposal: (plan: DraftPlan, window: DayAvailability[]) => void;
  persistenceStatus: 'loading' | 'saving' | 'saved' | 'error';
}) {
  const [status, setStatus] = useState<CheckInStatus | ''>(checkIn?.status ?? '');
  const [accomplished, setAccomplished] = useState(checkIn?.accomplished ?? '');
  const [remaining, setRemaining] = useState(checkIn?.remaining ?? '');
  const [blocker, setBlocker] = useState(checkIn?.blocker ?? '');
  const [justSaved, setJustSaved] = useState(false);
  const [answered, setAnswered] = useState<'accepted' | 'kept' | null>(null);
  const submit = () => {
    if (!status) return;
    save({ date, projectId: project.id, status, accomplished, remaining, blocker, savedAt: new Date().toISOString() });
    setJustSaved(true);
    setAnswered(null);
  };

  // Every status offers a change, but none of them applies one. Finishing early offers to bring
  // other work forward rather than doing it, so free time is never filled on its own.
  const offersReplan = justSaved && status !== '';
  const proposal = offersReplan ? buildProposal(replanOptionsFor(status, project.id, date)) : null;
  const hasChanges = Boolean(proposal && (proposal.changes.length > 0 || proposal.adjustments.length > 0));
  const saving = justSaved && persistenceStatus === 'saving';
  const failed = justSaved && persistenceStatus === 'error';
  const savedOk = justSaved && persistenceStatus === 'saved';

  return <Page>
    <Eyebrow>A GENTLE END-OF-DAY PAUSE</Eyebrow>
    <Title subtitle="This gives the next plan a clearer picture of what happened. Nothing moves until you say so.">How did today go?</Title>
    <Card style={styles.reviewFocus}><Text style={styles.reviewFocusLabel}>TODAY’S FOCUS</Text><Text style={styles.reviewFocusTitle}>{project.appName}</Text><Text style={styles.reviewFocusGoal}>{project.todayGoal || project.outcome || project.title}</Text></Card>
    <Text style={styles.reviewQuestion}>Pick the closest fit</Text>
    {REVIEW_OPTIONS.map(({ status: value, detail, icon }) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: status === value }} onPress={() => { setStatus(value); setJustSaved(false); setAnswered(null); }} style={[styles.reviewOption, status === value && styles.reviewOptionSelected]}>
      <View style={[styles.reviewOptionIcon, status === value && styles.reviewOptionIconSelected]}><Text style={[styles.reviewOptionIconText, status === value && styles.reviewOptionIconTextSelected]}>{icon}</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.reviewOptionTitle}>{value}</Text><Text style={styles.reviewOptionDescription}>{detail}</Text></View>
      <View style={[styles.radio, status === value && styles.radioSelected]}>{status === value ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>)}
    <Field label="WHAT DID YOU ACCOMPLISH? (OPTIONAL)" value={accomplished} onChangeText={setAccomplished} placeholder="A few words is enough" multiline />
    <Field label="WHAT REMAINS? (OPTIONAL)" value={remaining} onChangeText={setRemaining} placeholder="Anything to carry forward?" multiline />
    <Field label="WHAT CONFUSED OR BLOCKED YOU? (OPTIONAL)" value={blocker} onChangeText={setBlocker} placeholder="Write the question or obstacle" multiline />
    <PrimaryButton label={saving ? 'Saving check-in…' : failed ? 'Could not save check-in' : savedOk ? 'Check-in saved on this device' : 'Save check-in on this device'} onPress={submit} disabled={!status} />
    <Text style={savedOk ? styles.savedHint : styles.captureHint}>{savedOk ? `Today now shows “Checked in — ${status.toLowerCase()}”.` : failed ? 'The check-in could not be saved. Keep the app open and try saving again.' : justSaved ? 'Saving your check-in on this device…' : 'Choose a status and save. You decide whether the plan changes next.'}</Text>

    {offersReplan && !proposal ? <Card style={styles.reviewNotice}><Text style={styles.reviewNoticeText}>There is no accepted plan yet, so there is nothing to change. Build one in Plan when you are ready.</Text></Card> : null}

    {offersReplan && proposal && answered === null ? <FadeIn>
      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{hasChanges ? 'What would change' : 'Nothing needs to move'}</Text><Text style={styles.count}>{proposal.changes.length} DAYS</Text></View>
      {proposal.rolled ? <Card style={styles.reviewNotice}><Text style={styles.reviewNoticeText}>The week you last set up has passed, so this looks at the week starting {dateLabel(proposal.window[0].date)}.</Text></Card> : null}
      {status === 'Finished' && hasChanges ? <Card style={styles.reviewNotice}><Text style={styles.reviewNoticeText}>Finishing early does not fill your free time by itself. This is only a suggestion — nothing moves unless you accept it.</Text></Card> : null}
      {proposal.adjustments.map((adjustment) => <Card key={adjustment.projectId} style={styles.changeCard}>
        <Text style={styles.changeTitle}>{adjustment.title}</Text>
        <Text style={styles.changeBody}>This session counts as one focus day: {adjustment.from} left → {adjustment.to} left.</Text>
      </Card>)}
      {proposal.changes.map((change) => <Card key={change.date} style={styles.changeCard}>
        <Text style={styles.changeDate}>{dateLabel(change.date).toUpperCase()}</Text>
        <Text style={styles.changeBody}>{change.fromTitle ?? 'Open'} → {change.toTitle ?? 'Open'}</Text>
      </Card>)}
      {!hasChanges ? <Card style={styles.safePlan}><Text style={styles.safePlanTitle}>Your remaining work still fits</Text><Text style={styles.safePlanText}>Nothing has to move today. You can still rebuild the plan yourself in Plan.</Text></Card> : null}
      {proposal.risks.map((risk) => <Card key={risk.projectId} style={styles.riskCard}>
        <View style={styles.riskIcon}><Text style={styles.riskIconText}>!</Text></View>
        <View style={{ flex: 1 }}><Text style={styles.riskTitle}>{risk.title}</Text><Text style={styles.riskBody}>{risk.message}</Text></View>
      </Card>)}
      {hasChanges && proposal.risks.length ? <Text style={styles.captureHint}>Accepting keeps these warnings visible in Plan.</Text> : null}
      {hasChanges ? <PrimaryButton label={proposal.risks.length ? 'Accept these changes · keep risks visible' : 'Accept these changes'} onPress={() => { onAcceptProposal(proposal.plan, proposal.window); setAnswered('accepted'); }} /> : null}
      <Pressable onPress={() => setAnswered('kept')} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{hasChanges ? 'Leave my plan as it is' : 'Close'}</Text></Pressable>
    </FadeIn> : null}

    {answered === 'accepted' ? <FadeIn><Card style={styles.safePlan}><Text style={styles.safePlanTitle}>Plan updated</Text><Text style={styles.safePlanText}>Your plan now reflects today. Plan and Week both show it.</Text></Card></FadeIn> : null}
    {answered === 'kept' ? <FadeIn><Card style={styles.reviewNotice}><Text style={styles.reviewNoticeText}>Your plan is unchanged. Today is still recorded.</Text></Card></FadeIn> : null}
  </Page>;
}

const REVIEW_OPTIONS: { status: CheckInStatus; detail: string; icon: string }[] = [
  { status: 'Finished', detail: 'I reached today’s outcome', icon: '✓' },
  { status: 'Partly finished', detail: 'Some progress, some work remains', icon: '◐' },
  { status: 'Stuck', detail: 'I need to understand or unblock something', icon: '?' },
  { status: "Didn't start", detail: 'The day went a different way', icon: '–' },
];

function WeekScreen({ summary, onOpenPlan }: { summary: WeekSummary; onOpenPlan: () => void }) {
  const completion = summary.plannedCount ? Math.round((summary.completedCount / summary.plannedCount) * 100) : 0;
  const encouragement = summary.plannedCount === 0
    ? 'No focus days are on the plan for this week yet.'
    : summary.completedCount === 0
      ? 'No check-ins yet this week. The plan is still there when you are.'
      : `${summary.completedCount} of ${summary.plannedCount} planned focus days finished. The rest can be adjusted.`;
  const projects = summary.openWork.length === 1 ? 'PROJECT' : 'PROJECTS';
  return <Page>
    <Eyebrow>LOOK BACK · LOOK AHEAD</Eyebrow>
    <Title subtitle="A useful check on the plan, never a grade on you.">This week</Title>
    <Card style={styles.weekHighlight}>
      <Text style={styles.weekKicker}>FOCUS DAYS COMPLETED</Text>
      <View style={styles.weekNumberRow}><Text style={styles.weekNumber}>{summary.completedCount}</Text><Text style={styles.weekOf}>of {summary.plannedCount} planned{'\n'}focus days</Text></View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${completion}%` }]} /></View>
      <Text style={styles.weekEncouragement}>{encouragement}</Text>
      <Text style={styles.weekRange}>{dateLabel(summary.start)} – {dateLabel(summary.end)}</Text>
    </Card>
    {summary.partlyCount ? <Card style={styles.reviewNotice}><Text style={styles.reviewNoticeText}>{summary.partlyCount} {summary.partlyCount === 1 ? 'day was' : 'days were'} partly finished. Partial days are not counted as completed, and they are not nothing either.</Text></Card> : null}

    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Still open</Text><Text style={styles.count}>{summary.openWork.length} {projects}</Text></View>
    {summary.openWork.length
      ? summary.openWork.map((item) => <Card key={item.id} style={styles.summaryRow}>
          <View style={[styles.summaryDot, { backgroundColor: C.green }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryTitle}>{item.title}</Text>
            <Text style={styles.summaryDetail}>{item.openSessions} focus {item.openSessions === 1 ? 'day' : 'days'} not on the plan yet{item.deadline ? ` · due ${dateLabel(item.deadline)}` : ''}</Text>
          </View>
        </Card>)
      : <Text style={styles.emptyState}>Every project has its focus days on the plan.</Text>}

    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Coming up</Text>{summary.upcomingDeadlines.length ? <Text style={styles.count}>{summary.upcomingDeadlines.length} DUE</Text> : null}</View>
    {summary.risks.map((risk) => <Card key={risk.projectId} style={styles.riskCard}>
      <View style={styles.riskIcon}><Text style={styles.riskIconText}>!</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.riskTitle}>{risk.title}</Text>
        {risk.deadline ? <Text style={styles.riskDate}>DUE {dateLabel(risk.deadline).toUpperCase()}</Text> : null}
        <Text style={styles.riskBody}>{risk.message}</Text>
      </View>
    </Card>)}
    {summary.upcomingDeadlines.map((item) => <Card key={item.id} style={styles.summaryRow}>
      <View style={[styles.summaryDot, { backgroundColor: '#D19A57' }]} />
      <View style={{ flex: 1 }}><Text style={styles.summaryTitle}>{item.title}</Text><Text style={styles.summaryDetail}>Due {dateLabel(item.deadline)}</Text></View>
    </Card>)}
    {!summary.risks.length && !summary.upcomingDeadlines.length ? <Card style={styles.safePlan}><Text style={styles.safePlanTitle}>No deadline pressure</Text><Text style={styles.safePlanText}>Nothing on the plan is close to a deadline right now.</Text></Card> : null}
    {summary.plannedCount === 0 ? <PrimaryButton label="Build a plan for this week" onPress={onOpenPlan} /> : <Pressable onPress={onOpenPlan} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Open the plan</Text><Text style={styles.buttonArrow}>→</Text></Pressable>}
    <View style={styles.weekFooter}><Text style={styles.weekFooterIcon}>♡</Text><Text style={styles.weekFooterText}>A plan is here to support you. Change it when life changes.</Text></View>
  </Page>;
}

const STATUS_COPY: Record<NotificationPermission, string> = {
  unknown: 'Reminders have not been set up on this device yet.',
  granted: 'Reminders are allowed on this device.',
  denied: 'Notifications are switched off for this app, so reminders cannot arrive. Your phone’s settings can turn them back on.',
  unsupported: 'This device could not set up reminders. Everything else works as normal.',
};

const REMINDER_LABELS: Record<ReminderKind, { title: string; hint: string }> = {
  morning: { title: 'Morning', hint: 'A nudge to settle on today’s one focus.' },
  evening: { title: 'Evening', hint: 'A prompt to look back at how the day went.' },
};

function ReminderRow({ kind, setting, onChange }: { kind: ReminderKind; setting: ReminderSetting; onChange: (next: ReminderSetting) => void }) {
  const label = REMINDER_LABELS[kind];
  const step = (minutes: number) => onChange({ ...setting, ...shiftTime(setting.hour, setting.minute, minutes) });
  return <Card style={styles.reminderCard}>
    <View style={styles.reminderTop}>
      <View style={{ flex: 1 }}><Text style={styles.reminderTitle}>{label.title}</Text><Text style={styles.reminderHint}>{label.hint}</Text></View>
      <Pressable onPress={() => onChange({ ...setting, enabled: !setting.enabled })} accessibilityRole="switch" accessibilityState={{ checked: setting.enabled }} accessibilityLabel={`${label.title} reminder`} style={[styles.switch, setting.enabled && styles.switchOn]}>
        <View style={[styles.switchKnob, setting.enabled && styles.switchKnobOn]} />
      </Pressable>
    </View>
    {setting.enabled ? <View style={styles.timeRow}>
      <Pressable onPress={() => step(-60)} accessibilityRole="button" accessibilityLabel={`${label.title} an hour earlier`} style={styles.timeStep}><Text style={styles.timeStepText}>−1h</Text></Pressable>
      <Pressable onPress={() => step(-15)} accessibilityRole="button" accessibilityLabel={`${label.title} fifteen minutes earlier`} style={styles.timeStep}><Text style={styles.timeStepText}>−15m</Text></Pressable>
      <Text style={styles.timeValue}>{formatClockTime(setting.hour, setting.minute)}</Text>
      <Pressable onPress={() => step(15)} accessibilityRole="button" accessibilityLabel={`${label.title} fifteen minutes later`} style={styles.timeStep}><Text style={styles.timeStepText}>+15m</Text></Pressable>
      <Pressable onPress={() => step(60)} accessibilityRole="button" accessibilityLabel={`${label.title} an hour later`} style={styles.timeStep}><Text style={styles.timeStepText}>+1h</Text></Pressable>
    </View> : null}
  </Card>;
}

function SettingsScreen({ reminders, status, onChange, onRequestPermission, onSendTest, onClose }: {
  reminders: ReminderSettings;
  status: NotificationPermission;
  onChange: (settings: ReminderSettings) => void;
  onRequestPermission: () => void;
  onSendTest: () => void;
  onClose: () => void;
}) {
  const update = (kind: ReminderKind, next: ReminderSetting) => {
    onChange({ ...reminders, [kind]: next });
    // Enabling a reminder is an explicit request, so it is a fine moment to ask for permission.
    if (next.enabled && status !== 'granted') onRequestPermission();
  };
  const allowed = status === 'granted';
  return <Page>
    <Eyebrow>ON THIS DEVICE</Eyebrow>
    <Title subtitle="Two quiet nudges: one to start, one to look back.">Reminders</Title>
    <Card style={allowed ? styles.safePlan : styles.reviewNotice}>
      <Text style={allowed ? styles.safePlanText : styles.reviewNoticeText}>{STATUS_COPY[status]}</Text>
      {status === 'unknown' ? <Pressable onPress={onRequestPermission} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Allow reminders</Text></Pressable> : null}
      {status === 'denied' ? <Pressable onPress={() => { Linking.openSettings(); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Open phone settings</Text></Pressable> : null}
      {allowed ? <Pressable onPress={onSendTest} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Send a test reminder</Text></Pressable> : null}
    </Card>
    {REMINDER_KINDS.map((kind) => <ReminderRow key={kind} kind={kind} setting={reminders[kind]} onChange={(next) => update(kind, next)} />)}
    <Text style={styles.captureHint}>Reminders are scheduled on this phone. If it is off at the time, one arrives when it next can. Android may also ask you to allow “Alarms &amp; reminders” for this app.</Text>
    <Pressable onPress={onClose} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Done</Text></Pressable>
  </Page>;
}

const styles = StyleSheet.create({
  topBar: { height: 62, paddingHorizontal: 21, flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { height: 34, width: 34, borderRadius: 12, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }, brandIcon: { color: '#F4EACD', fontSize: 20 },
  brand: { color: C.ink, fontWeight: '800', fontSize: 16, letterSpacing: -0.25 }, brandSub: { color: C.muted, fontSize: 10, marginTop: 1 }, avatar: { height: 31, width: 31, backgroundColor: '#E4E1D3', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: C.ink, fontWeight: '700', fontSize: 12 },
  page: { paddingHorizontal: 21, paddingTop: 12, paddingBottom: 30 }, eyebrow: { color: C.green, fontSize: 9, letterSpacing: 1.4, fontWeight: '800', marginBottom: 9 }, titleBlock: { marginBottom: 18 }, title: { color: C.ink, fontSize: 28, fontWeight: '800', letterSpacing: -1.1 }, subtitle: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 330 },
  checkedBanner: { flexDirection: 'row', gap: 9, alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: '#D5E3D5', backgroundColor: '#EBF3E9', padding: 11, marginBottom: 12 }, checkedIcon: { fontSize: 16, color: C.green, fontWeight: '800' }, checkedTitle: { color: C.green, fontSize: 11, fontWeight: '800' }, checkedCaption: { color: '#64806B', fontSize: 9, marginTop: 2 }, workTypeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingHorizontal: 2 }, workTypeLabel: { color: C.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  heroCard: { backgroundColor: C.green, borderRadius: 22, padding: 20, marginBottom: 22, overflow: 'hidden' }, heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, heroSpark: { color: '#D8C98E', fontSize: 29, marginTop: -8, marginRight: -4 }, projectContext: { color: '#C8D9C9', fontSize: 10, fontWeight: '700', marginTop: 10 }, heroTitle: { color: '#FBFAF5', fontSize: 29, fontWeight: '800', lineHeight: 34, letterSpacing: -0.8, marginTop: 4 }, heroDescription: { color: '#D5E2D7', fontSize: 12, lineHeight: 18, marginTop: 6 }, heroDivider: { height: 1, backgroundColor: '#547560', marginVertical: 15 }, heroLabel: { color: '#C5D4C6', fontSize: 8, letterSpacing: 1.2, fontWeight: '800' }, heroReason: { color: '#F5F5EF', fontSize: 11, lineHeight: 17, marginTop: 5 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20 }, pillGreen: { backgroundColor: '#DCE8D9' }, pillYellow: { backgroundColor: C.yellow }, pillBlue: { backgroundColor: C.blue }, pillOrange: { backgroundColor: C.orange }, pillText: { fontWeight: '800', fontSize: 8, letterSpacing: 0.55 }, pillTextGreen: { color: C.green }, pillTextYellow: { color: C.yellowInk }, pillTextBlue: { color: C.blueInk }, pillTextOrange: { color: '#8B5D40' },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, marginBottom: 10, gap: 5 }, sectionTitle: { color: C.ink, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 }, card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14 },
  goalCard: { flexDirection: 'row', gap: 11, marginBottom: 18, paddingVertical: 14 }, goalNumber: { width: 26, height: 26, borderRadius: 9, backgroundColor: C.greenLight, justifyContent: 'center', alignItems: 'center' }, goalCheckText: { color: C.green, fontSize: 12, fontWeight: '800' }, goalTitle: { color: C.ink, fontSize: 12, fontWeight: '800', lineHeight: 18 }, goalDescription: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  stepCard: { flexDirection: 'row', gap: 10, marginBottom: 17, alignItems: 'flex-start' }, stepIcon: { height: 28, width: 28, borderRadius: 10, backgroundColor: '#F1EFE5', alignItems: 'center', justifyContent: 'center' }, stepIconText: { color: C.green, fontSize: 12, fontWeight: '800' }, stepLabel: { color: C.muted, fontSize: 7, fontWeight: '800', letterSpacing: 0.65, lineHeight: 12 }, stepText: { color: C.ink, fontSize: 11, fontWeight: '600', lineHeight: 17, marginTop: 4 },
  journeyCard: { marginBottom: 16, padding: 13 }, journeyCaption: { color: C.muted, fontSize: 7, letterSpacing: 0.8, fontWeight: '800' }, journeyStep: { color: C.ink, fontSize: 9, fontWeight: '800' }, todaySlice: { color: C.green, fontSize: 9, lineHeight: 14, marginTop: 10, fontWeight: '700' },
  stuckCard: { backgroundColor: '#F1EEE3', borderRadius: 15, padding: 13, marginBottom: 16 }, stuckTitle: { color: '#66562F', fontSize: 11, fontWeight: '800' }, stuckText: { color: '#706B5B', fontSize: 10, lineHeight: 15, marginTop: 5 }, outlineButton: { height: 46, borderRadius: 14, borderWidth: 1, borderColor: '#CDD6CC', backgroundColor: '#FCFCF8', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }, outlineButtonText: { color: C.green, fontWeight: '800', fontSize: 12 }, buttonArrow: { color: C.green, fontSize: 16 },
  planNote: { backgroundColor: '#EBF0E9', borderColor: '#DFE8DE', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, marginBottom: 16 }, planNoteIcon: { width: 26, height: 26, backgroundColor: '#DDE8DB', borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, planNoteText: { color: '#4C6653', fontSize: 10, lineHeight: 15, flex: 1 },
  weekReset: { alignSelf: 'flex-end', paddingVertical: 7, paddingHorizontal: 2 }, weekResetText: { color: C.green, fontSize: 8, fontWeight: '800' }, availabilityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 }, availabilityDay: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 10 }, availabilityDayActive: { backgroundColor: '#F3F7F2', borderColor: '#D6E1D5' }, availabilityName: { color: C.muted, fontSize: 10, fontWeight: '700' }, availabilityNameActive: { color: C.green }, availabilityToggle: { color: C.muted, fontSize: 8, fontWeight: '700' }, timeButton: { width: 86, alignItems: 'center', backgroundColor: '#ECEEE8', borderRadius: 11, paddingVertical: 7 }, timeButtonText: { color: C.ink, fontSize: 9, fontWeight: '800' }, timeHint: { color: C.muted, fontSize: 6, marginTop: 2 },
  projectChoice: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 11, marginTop: 7 }, checkbox: { width: 19, height: 19, borderRadius: 6, borderWidth: 1, borderColor: '#C9D0C8', alignItems: 'center', justifyContent: 'center' }, checkboxSelected: { borderColor: C.green, backgroundColor: C.green }, checkboxTick: { color: C.white, fontSize: 12, fontWeight: '800' }, projectChoiceTitle: { color: C.ink, fontSize: 10, fontWeight: '800' }, projectChoiceContext: { color: C.green, fontSize: 8, fontWeight: '700', marginTop: 3 }, projectChoiceMeta: { color: C.muted, fontSize: 8, lineHeight: 12, marginTop: 3, textTransform: 'capitalize' },
  secondaryButton: { borderRadius: 13, borderWidth: 1, borderColor: '#CBD6CC', backgroundColor: C.white, minHeight: 39, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 9 }, secondaryButtonText: { color: C.green, fontSize: 9, fontWeight: '800', textAlign: 'center' }, plannedDayCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, marginTop: 8 }, dayBadges: { flexDirection: 'row', gap: 5 }, plannedDate: { color: C.muted, fontSize: 9, fontWeight: '800' }, plannedProjectName: { color: C.ink, fontSize: 12, fontWeight: '800', marginTop: 8 }, dayWhy: { color: C.muted, fontSize: 8, lineHeight: 12, marginTop: 5 }, safePlan: { backgroundColor: '#EFF5ED', borderColor: '#DDE8DA', marginTop: 13 }, safePlanTitle: { color: C.green, fontSize: 11, fontWeight: '800' }, safePlanText: { color: '#637568', fontSize: 9, lineHeight: 14, marginTop: 4 }, choiceButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }, choiceButtonText: { color: C.ink, fontSize: 11, fontWeight: '700' }, choiceSelected: { color: C.green, fontSize: 8, fontWeight: '800' }, lockButton: { alignItems: 'center', borderWidth: 1, borderColor: '#CBD6CC', borderRadius: 11, paddingVertical: 12, marginTop: 15 }, lockButtonText: { color: C.green, fontSize: 10, fontWeight: '800' }, dayCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }, dayContext: { color: C.green, fontSize: 8, fontWeight: '700', marginTop: 4 }, dayDescription: { color: C.muted, fontSize: 9, lineHeight: 14, marginTop: 4 }, tapHint: { color: '#98A098', fontSize: 6, letterSpacing: 0.8, fontWeight: '800', textAlign: 'right', marginTop: 6 },
  captureCard: { padding: 14, marginBottom: 13 }, captureLabel: { fontSize: 8, color: C.muted, letterSpacing: 1, fontWeight: '800' }, modeRow: { flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 13 }, modeButton: { flex: 1, borderRadius: 11, backgroundColor: '#F1F1EB', paddingVertical: 9, paddingHorizontal: 6, alignItems: 'center' }, modeButtonActive: { backgroundColor: C.greenLight }, modeText: { color: C.muted, fontWeight: '700', fontSize: 9, textAlign: 'center' }, modeTextActive: { color: C.green }, kindRow: { gap: 6, paddingTop: 8, paddingBottom: 10 }, kindChip: { borderRadius: 18, backgroundColor: '#F2F2EB', paddingHorizontal: 11, paddingVertical: 7 }, kindChipActive: { backgroundColor: C.greenLight }, kindChipText: { color: C.muted, fontSize: 9, fontWeight: '700' }, kindChipTextActive: { color: C.green }, field: { marginTop: 11 }, fieldCompact: { marginTop: 10 }, fieldLabel: { color: C.muted, fontSize: 7, fontWeight: '800', letterSpacing: 0.65, marginBottom: 5 }, fieldInput: { color: C.ink, fontSize: 11, minHeight: 37, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: '#FCFCF9' }, fieldInputCompact: { backgroundColor: C.white }, fieldMultiline: { minHeight: 66, textAlignVertical: 'top' }, moreToggle: { paddingVertical: 11 }, moreToggleText: { color: C.green, fontSize: 9, fontWeight: '800' }, extraFields: { padding: 11, borderRadius: 12, backgroundColor: '#F5F4EE', marginBottom: 11 }, editWorkLabel: { marginTop: 14 }, editModeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 }, primaryButton: { backgroundColor: C.green, minHeight: 43, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }, primaryButtonText: { color: '#FFF', fontWeight: '800', fontSize: 10 }, primaryButtonArrow: { color: '#E3E9DC', fontSize: 15, fontWeight: '600' }, primaryButtonDisabled: { backgroundColor: '#829389' }, captureHint: { color: C.muted, textAlign: 'center', fontSize: 8, lineHeight: 13, marginTop: 9 }, count: { color: '#939A92', fontSize: 7, fontWeight: '800', letterSpacing: 0.8 }, inboxItem: { backgroundColor: C.white, borderColor: C.line, borderWidth: 1, borderRadius: 15, padding: 12, marginBottom: 8 }, inboxItemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 }, itemName: { color: C.ink, fontSize: 11, fontWeight: '800', flex: 1 }, itemContext: { color: C.green, fontSize: 8, fontWeight: '700', marginTop: 5 }, itemDetail: { color: C.muted, fontSize: 9, lineHeight: 14, marginTop: 5 }, itemDeadline: { color: C.yellowInk, fontSize: 7, fontWeight: '800', marginTop: 5 }, itemMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 5 }, itemKind: { color: '#929990', fontSize: 7, fontWeight: '800', letterSpacing: 0.8 }, itemUnscheduled: { color: C.blueInk, fontSize: 6, fontWeight: '800', textAlign: 'right', flexShrink: 1 }, emptyState: { color: C.muted, textAlign: 'center', padding: 16, fontSize: 10 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(22, 35, 27, 0.35)' }, modalSheet: { maxHeight: '88%', minHeight: '35%', backgroundColor: C.paper, borderTopLeftRadius: 23, borderTopRightRadius: 23, paddingHorizontal: 19, paddingTop: 9, paddingBottom: 28 }, modalHandle: { width: 36, height: 4, borderRadius: 3, backgroundColor: '#D1D5CC', alignSelf: 'center', marginBottom: 13 }, modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, closeButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#E9EAE2', alignItems: 'center', justifyContent: 'center' }, closeText: { color: C.ink, fontSize: 21, lineHeight: 23 }, modalTitle: { color: C.ink, fontSize: 23, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 }, modalContext: { color: C.green, fontSize: 10, lineHeight: 15, fontWeight: '700', marginTop: 4, marginBottom: 14 }, modalSectionLabel: { color: C.muted, fontSize: 7, letterSpacing: 0.8, fontWeight: '800', marginTop: 15, marginBottom: 5 }, modalBody: { color: C.ink, fontSize: 11, lineHeight: 17 }, backupInput: { minHeight: 200, maxHeight: 360, marginTop: 12, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 9 }, detailStatus: { color: C.blueInk, fontSize: 8, fontWeight: '800', marginBottom: 2 }, detailSection: { marginTop: 9 }, editButton: { borderRadius: 12, borderWidth: 1, borderColor: '#CBD6CC', backgroundColor: C.white, paddingVertical: 12, alignItems: 'center', marginTop: 18, marginBottom: 8 }, editButtonText: { color: C.green, fontSize: 10, fontWeight: '800' }, useTodayButton: { borderRadius: 13, backgroundColor: C.green, padding: 12, alignItems: 'center', marginTop: 18, marginBottom: 8 }, useTodayButtonText: { color: C.white, fontSize: 10, fontWeight: '800', textAlign: 'center' }, useTodayHint: { color: '#DDE8DD', fontSize: 8, lineHeight: 12, textAlign: 'center', marginTop: 5 },
  reviewFocus: { backgroundColor: '#EDF1EA', borderColor: '#E0E7DF', marginBottom: 19 }, reviewFocusLabel: { color: C.green, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 }, reviewFocusTitle: { color: C.ink, fontSize: 15, fontWeight: '800', marginTop: 7 }, reviewFocusGoal: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 4 }, reviewQuestion: { color: C.ink, fontSize: 12, fontWeight: '800', marginBottom: 9, marginTop: 2 }, reviewOption: { borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 7 }, reviewOptionSelected: { borderColor: '#91AB96', backgroundColor: '#F8FAF6' }, reviewOptionIcon: { height: 29, width: 29, borderRadius: 10, backgroundColor: '#F3F2EC', alignItems: 'center', justifyContent: 'center' }, reviewOptionIconSelected: { backgroundColor: C.greenLight }, reviewOptionIconText: { color: C.muted, fontSize: 13, fontWeight: '800' }, reviewOptionIconTextSelected: { color: C.green }, reviewOptionTitle: { color: C.ink, fontSize: 11, fontWeight: '800' }, reviewOptionDescription: { color: C.muted, fontSize: 9, marginTop: 2 }, radio: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.3, borderColor: '#CDD2CA', alignItems: 'center', justifyContent: 'center' }, radioSelected: { borderColor: C.green }, radioDot: { height: 9, width: 9, borderRadius: 5, backgroundColor: C.green }, savedHint: { color: C.green, fontSize: 9, textAlign: 'center', lineHeight: 14, marginTop: 10 },
  weekHighlight: { backgroundColor: C.green, borderColor: C.green, padding: 18, marginBottom: 20 }, weekKicker: { color: '#C6D6C8', fontSize: 8, fontWeight: '800', letterSpacing: 1 }, weekNumberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }, weekNumber: { color: '#FCFBF5', fontSize: 45, lineHeight: 50, fontWeight: '800', letterSpacing: -1.5 }, weekOf: { color: '#D7E2D8', fontSize: 11, lineHeight: 16 }, progressTrack: { height: 5, borderRadius: 4, backgroundColor: '#587662', marginTop: 13, overflow: 'hidden' }, progressFill: { height: 5, width: '40%', backgroundColor: '#E7D49A', borderRadius: 4 }, weekEncouragement: { color: '#E0E8DC', fontSize: 10, lineHeight: 15, marginTop: 11 }, tourBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.paper, justifyContent: 'center', paddingHorizontal: 30 }, tourStep: { color: C.green, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 10 }, tourTitle: { color: C.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.8, lineHeight: 32 }, tourBody: { color: C.muted, fontSize: 13, lineHeight: 20, marginTop: 10 }, tourDots: { flexDirection: 'row', gap: 6, marginTop: 26, marginBottom: 18 }, tourDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D8DCD3' }, tourDotOn: { backgroundColor: C.green, width: 20 }, tourRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, minHeight: 22 }, tourLink: { color: C.green, fontSize: 11, fontWeight: '800' },
  weekRange: { color: '#A9BFAE', fontSize: 8, fontWeight: '800', letterSpacing: 0.6, marginTop: 8 }, summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 7, paddingVertical: 12 }, summaryDot: { height: 8, width: 8, borderRadius: 5 }, summaryTitle: { color: C.ink, fontSize: 11, fontWeight: '800' }, summaryDetail: { color: C.muted, fontSize: 9, lineHeight: 14, marginTop: 3 }, riskCard: { flexDirection: 'row', gap: 10, backgroundColor: '#FBF8EF', borderColor: '#EEE6CE', padding: 13 }, riskIcon: { width: 28, height: 28, borderRadius: 10, backgroundColor: '#F1E8D2', alignItems: 'center', justifyContent: 'center' }, riskIconText: { color: C.yellowInk, fontSize: 15 }, riskTitle: { color: C.ink, fontWeight: '800', fontSize: 11 }, riskDate: { color: C.yellowInk, fontSize: 7, fontWeight: '800', letterSpacing: 0.6, marginTop: 4 }, riskBody: { color: '#76756C', fontSize: 9, lineHeight: 14, marginTop: 5 }, weekFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingHorizontal: 3 }, weekFooterIcon: { color: C.green, fontSize: 15 }, weekFooterText: { flex: 1, color: C.muted, fontSize: 9, lineHeight: 14 },
  loadProblemCard: { backgroundColor: '#FBF8EF', borderColor: '#EEE6CE', marginBottom: 16 }, loadProblemTitle: { color: C.yellowInk, fontSize: 11, fontWeight: '800' }, loadProblemText: { color: '#76756C', fontSize: 9, lineHeight: 14, marginTop: 5 },
  projectChoiceMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  deleteProjectButton: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange }, deleteProjectText: { color: '#8B5D40', fontSize: 16, lineHeight: 19, fontWeight: '800' },
  dangerButton: { backgroundColor: '#8B5D40', minHeight: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, dangerButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 10 },
  cancelButton: { alignItems: 'center', borderWidth: 1, borderColor: '#CBD6CC', borderRadius: 11, paddingVertical: 12, marginTop: 9 }, cancelButtonText: { color: C.green, fontSize: 10, fontWeight: '800' },
  completedActionCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: '#EEF4EB', borderColor: '#DDE8DA', marginBottom: 7 }, completedActionCheck: { color: C.green, fontSize: 13, fontWeight: '800' }, completedActionLabel: { color: C.green, fontSize: 7, fontWeight: '800', letterSpacing: 0.7 }, completedActionText: { color: C.ink, fontSize: 10, lineHeight: 15, marginTop: 3 },
  reviewNotice: { backgroundColor: '#FBF8EF', borderColor: '#EEE6CE', marginBottom: 14 }, reviewNoticeText: { color: C.yellowInk, fontSize: 9, lineHeight: 14 },
  changeCard: { marginTop: 8, paddingVertical: 11 }, changeDate: { color: C.green, fontSize: 8, fontWeight: '800', letterSpacing: 0.7 }, changeTitle: { color: C.ink, fontSize: 11, fontWeight: '800' }, changeBody: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  reminderCard: { marginBottom: 9, paddingVertical: 13 }, reminderTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, reminderTitle: { color: C.ink, fontSize: 12, fontWeight: '800' }, reminderHint: { color: C.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: '#E2E4DC', padding: 3, justifyContent: 'center' }, switchOn: { backgroundColor: C.green }, switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' }, switchKnobOn: { alignSelf: 'flex-end' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5, marginTop: 12 }, timeStep: { minWidth: 46, alignItems: 'center', backgroundColor: '#F1F1EB', borderRadius: 9, paddingVertical: 8, paddingHorizontal: 6 }, timeStepText: { color: C.green, fontSize: 9, fontWeight: '800' }, timeValue: { color: C.ink, fontSize: 15, fontWeight: '800', minWidth: 76, textAlign: 'center' },});
