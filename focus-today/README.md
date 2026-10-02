# One Focus — one thing at a time

An Expo + React Native app for choosing one realistic focus each day, working entirely on your
phone.

## Install it

The app is a standalone Android build. It does **not** need Expo Go, a computer, or a dev server.

1. Copy `one-focus-1.0.0.apk` to the phone (USB, cloud drive, or any file transfer).
2. Tap it and allow installing from this source when Android asks.
3. Open **One Focus**.

Everything is stored on the phone. No account, no network, no backend.

## Getting started

**The app starts empty.** Nothing is pre-filled and no sample data is loaded, so the first thing
you see is a short walkthrough, and then an invitation to capture something. The walkthrough is
shown once.

1. **Inbox** — capture anything you might want to focus on. A name is enough; every other field
   is optional and can wait.
2. **Plan** — set which days you can work and roughly how long, tick the projects to include,
   then create a draft. Review it, lock any day you want kept fixed, and accept it.
3. **Today** — the one project you are on, with a single next action. It greets you by the time
   of day. Mark actions done as you go, or stop for the day.
4. **Review** — at the end of the day, record how it went. If the day did not go to plan, the app
   proposes what would change and explains the trade-offs first. Nothing moves until you accept.
5. **Week** — how many focus days you have finished out of the plan, what is still unplaced, and
   what is coming up.

## How the days work

The planning window is the **seven days starting today**, so the day you are actually on is
always part of the plan and a check-in for it always counts. Each day carries its own time block,
and a focus session uses that block.

The planner puts at most one project on a day, explains each choice, and reports work that does
not fit rather than quietly adding days. Accepting a plan is always a deliberate step, and
finishing early never fills your free time by itself.

## Reminders

Tap **⚙** in the header to set a morning and an evening reminder, or switch either off. They are
scheduled on the phone and survive a restart. **Send a test reminder** checks the whole path
without waiting until the next morning.

Reminders use the app's own chime, so one is recognisable as coming from One Focus rather than
sounding like every other app.

If notifications are off, the screen says so and offers a way to your phone's settings.
Android may also want "Alarms & reminders" allowed for the app. Reminders are best-effort to the
minute, not to the second.

## Limits

No accounts and no network sync. Work estimates are rough focus sessions; a project always keeps
at least one session, so there is no separate "done" state yet — a project you have finished
will still ask for a day until you delete it or set it aside.

A check-in counts as a completed focus day only when you mark it **Finished**; a partly finished
day is reported separately. Check-ins recorded before check-ins were dated are kept in your saved
data and backups but are not shown anywhere.

Reminders are local notifications — nothing travels through a server — and one that falls while
the phone is off arrives when it next can.

**Backups:** open **Export or restore a backup** in Plan. The export is JSON you can copy
somewhere safe and paste back to restore.

## Working on it

```bash
npm install          # install dependencies
npx expo start       # run against a development build or Expo Go
npm test             # pure-logic test suites (node --test)
npx tsc --noEmit     # typecheck
npx expo lint        # lint
```

The app logic lives in `state.ts` (saved state and its transitions), `planner.ts` (how work is
placed on days), `week.ts` (the Week dashboard), `reminders.ts` (reminder times and copy), `brand.ts` (the app's name, tagline and greeting) and
`notifications.ts` (the only module that talks to expo-notifications). Everything except
`notifications.ts` and the screens is pure and unit-tested, which is why the tests can run with
no device and no native modules.

### Building the APK

```bash
export ANDROID_HOME=$HOME/Android/Sdk
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The APK lands in `android/app/build/outputs/apk/release/`. It is signed with the Android debug
keystore, which is fine for installing on your own phone; rebuilding from the same machine will
update over the installed app, but a different keystore would require uninstalling first.
