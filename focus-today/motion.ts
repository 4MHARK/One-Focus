// Animation timing rules, kept free of any React or React Native import so the test runner can
// load this file. The hook and the animated view that use it live in App.tsx.

/** The app's standard motion timings, in milliseconds. */
export const MOTION = {
  quick: 160,
  normal: 260,
  slow: 380,
} as const;

/**
 * How long an animation should take, honouring the phone's reduced-motion setting.
 *
 * Returning 0 is deliberate: callers must treat it as "apply the end state immediately", so a
 * reduced-motion user gets no transition rather than a very fast one.
 */
export function motionDuration(reducedMotion: boolean, base: number = MOTION.normal): number {
  return reducedMotion ? 0 : Math.max(0, base);
}

/** A small rise used for things appearing in place, scaled to nothing when motion is reduced. */
export function motionOffset(reducedMotion: boolean, distance = 8): number {
  return reducedMotion ? 0 : distance;
}
