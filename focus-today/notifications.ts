// The only module that talks to expo-notifications. Reminder times, copy, and the next-occurrence
// maths live in reminders.ts, which stays free of native imports so `node --test` can load it.
//
// Ordering matters here and is the main silent-failure risk on Android: the notification channel
// must exist *before* the permission is requested, because Android 13+ will not show the prompt
// until at least one channel has been created. Every call is wrapped so a notifications failure
// degrades to a status the UI can explain, never a crash.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { activeReminders, REMINDER_KINDS, reminderIdentifier, type ReminderSettings } from './reminders';

export type NotificationPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

export const REMINDER_CHANNEL_ID = 'reminders';

/**
 * Our own chime, bundled through the expo-notifications config plugin. On Android 8+ a
 * notification's sound belongs to its channel, so this is set here rather than per notification
 * — and it is what makes a reminder recognisable as coming from this app.
 */
export const REMINDER_SOUND = 'notification.wav';

/** Reminders should be visible while the app is open, not swallowed by the foreground. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// Installed here, at module scope, rather than from a component: the default with no handler is
// to show nothing, so a reminder arriving before the first render would vanish. Importing this
// module — which App.tsx does at startup — is enough to arm it.
configureNotificationHandler();

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    description: 'A morning nudge to focus, and an evening nudge to check in.',
    sound: REMINDER_SOUND,
  });
}

export async function getPermission(): Promise<NotificationPermission> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    // A first run has simply not asked yet. Reporting that as 'denied' sent people to their
    // phone settings to switch on notifications for an app that had never requested them.
    return current.canAskAgain === false ? 'denied' : 'unknown';
  } catch {
    return 'unsupported';
  }
}

/** Ask for permission, creating the Android channel first so the prompt can actually appear. */
export async function requestPermission(): Promise<NotificationPermission> {
  try {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (current.canAskAgain === false) return 'denied';
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/**
 * Fire one immediately, so the setup can be checked without waiting until the next morning.
 * `trigger: null` means deliver now.
 */
export async function sendTestNotification(): Promise<NotificationPermission> {
  try {
    await ensureChannel();
    const permission = await getPermission();
    if (permission !== 'granted') return permission;
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Reminders are working', body: 'This is what your morning and evening nudges will look like.' },
      // ChannelAwareTriggerInput: delivered immediately, but on the reminders channel rather than
      // the fallback one. `null` would post to "Miscellaneous", so the test would not show what a
      // real reminder actually looks like.
      trigger: { channelId: REMINDER_CHANNEL_ID },
    });
    return permission;
  } catch {
    return 'unsupported';
  }
}

async function cancelOurReminders(): Promise<void> {
  // Cancel by our own identifiers rather than everything, so unrelated notifications could be
  // added later without this wiping them.
  for (const kind of REMINDER_KINDS) {
    await Notifications.cancelScheduledNotificationAsync(reminderIdentifier(kind)).catch(() => {});
  }
}

/**
 * Make the scheduled reminders match the saved settings. Cancels first, so switching a reminder
 * off or changing its time can never leave an older schedule running underneath.
 */
export async function syncReminders(settings: ReminderSettings, askFirst = false): Promise<NotificationPermission> {
  try {
    await ensureChannel();
    const permission = askFirst ? await requestPermission() : await getPermission();
    await cancelOurReminders();
    if (permission !== 'granted') return permission;

    for (const reminder of activeReminders(settings)) {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.identifier,
        content: { title: reminder.title, body: reminder.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: reminder.hour,
          minute: reminder.minute,
          channelId: REMINDER_CHANNEL_ID,
        },
      });
    }
    return permission;
  } catch {
    return 'unsupported';
  }
}
