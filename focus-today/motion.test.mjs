import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION, motionDuration, motionOffset } from './motion.ts';

test('animations take their normal time when motion is allowed', () => {
  assert.equal(motionDuration(false), MOTION.normal);
  assert.equal(motionDuration(false, MOTION.quick), MOTION.quick);
});

test('reduced motion collapses an animation to nothing rather than speeding it up', () => {
  // Zero is the signal to jump straight to the end state. A short duration would still be
  // movement, which is the thing the setting exists to remove.
  assert.equal(motionDuration(true), 0);
  assert.equal(motionDuration(true, MOTION.slow), 0);
  assert.equal(motionOffset(true), 0);
});

test('the rise applied to new items disappears under reduced motion', () => {
  assert.equal(motionOffset(false), 8);
  assert.equal(motionOffset(false, 20), 20);
  assert.equal(motionOffset(true, 20), 0);
});

test('a negative duration can never come out', () => {
  assert.equal(motionDuration(false, -50), 0);
});

test('the timings stay in a range that reads as subtle', () => {
  for (const value of Object.values(MOTION)) {
    assert.ok(value > 0 && value <= 500, `${value}ms is outside a subtle range`);
  }
});
