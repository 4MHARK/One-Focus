// The app's identity and its time-aware greeting, in one place so a rename only happens once.

export const APP_NAME = 'One Focus';
export const APP_TAGLINE = 'One thing at a time';

/**
 * A greeting for the hour, optionally to someone.
 *
 * Reads the hour rather than the clock so it stays pure and testable; the screen passes
 * `new Date().getHours()` in. `name` is accepted now so "Good morning, Ada" needs no rewrite
 * later — it is simply omitted until a name is captured.
 */
export function greeting(hour: number, name?: string): string {
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const trimmed = name?.trim();
  return trimmed ? `${part}, ${trimmed}` : part;
}

export function greetingFor(date: Date, name?: string): string {
  return greeting(date.getHours(), name);
}
