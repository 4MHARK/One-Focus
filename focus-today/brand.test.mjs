import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_NAME, APP_TAGLINE, greeting, greetingFor } from './brand.ts';

test('the identity is defined in exactly one place', () => {
  assert.equal(typeof APP_NAME, 'string');
  assert.ok(APP_NAME.length > 0);
  assert.ok(APP_TAGLINE.length > 0);
});

test('the greeting follows the hour', () => {
  assert.equal(greeting(0), 'Good morning');
  assert.equal(greeting(9), 'Good morning');
  assert.equal(greeting(11), 'Good morning');
  assert.equal(greeting(12), 'Good afternoon');
  assert.equal(greeting(16), 'Good afternoon');
  assert.equal(greeting(17), 'Good evening');
  assert.equal(greeting(23), 'Good evening');
});

test('every hour of the day produces a greeting', () => {
  for (let hour = 0; hour < 24; hour += 1) {
    assert.match(greeting(hour), /^Good (morning|afternoon|evening)$/, `hour ${hour}`);
  }
});

test('a name is appended when there is one, and left out when there is not', () => {
  assert.equal(greeting(8, 'Ada'), 'Good morning, Ada');
  assert.equal(greeting(20, 'Ada'), 'Good evening, Ada');
  assert.equal(greeting(8), 'Good morning');
  assert.equal(greeting(8, ''), 'Good morning', 'an empty name is not a name');
  assert.equal(greeting(8, '   '), 'Good morning', 'nor is whitespace');
  assert.equal(greeting(8, '  Ada  '), 'Good morning, Ada', 'and it is trimmed');
});

test('the greeting can be taken straight from a date', () => {
  assert.equal(greetingFor(new Date(2026, 9, 2, 7, 30)), 'Good morning');
  assert.equal(greetingFor(new Date(2026, 9, 2, 14, 0)), 'Good afternoon');
  assert.equal(greetingFor(new Date(2026, 9, 2, 19, 0), 'Ada'), 'Good evening, Ada');
});
