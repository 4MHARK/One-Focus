# One Focus

An Android app for choosing **one focus a day** — and actually finishing it.

The app lives in [`focus-today/`](./focus-today). Its own documentation, including how to install
the APK and how to build it, is in [`focus-today/README.md`](./focus-today/README.md).

## What it does

- **Inbox** — capture anything you might focus on, in your own words. Nothing is scheduled yet.
- **Plan** — set the days you can work and roughly how long; the app drafts a plan and you decide
  whether to accept it.
- **Today** — a single project, a single next action, and a greeting by the time of day.
- **Review** — check in at the end of the day. If things slipped, the app proposes what would
  change and explains the trade-offs before anything moves.
- **Week** — how many focus days you have finished against the plan, what is still unplaced, and
  what is coming up.

Everything is kept on the phone. There is no account, no network sync, and no backend.

## Quick start

```bash
cd focus-today
npm install
npx expo start        # run against a development build or Expo Go
npm test              # pure-logic test suites
```

To build an installable Android APK, see the *Working on it* section of
[`focus-today/README.md`](./focus-today/README.md).

## Repository layout

```
administration/
├── README.md          ← this file
└── focus-today/       ← the app (its own git repository)
```

Note that `focus-today/` is a **separate git repository** nested inside this one, not a tracked
folder. This repository therefore records it as a submodule pointer rather than as files, which
means the app's source code is *not* part of this repository's contents. If you want the app's
code committed here directly, remove `focus-today/.git` first so the folder becomes ordinary
files, then commit them.
