/**
 * Tests for the router's pure rule-matching logic.
 *
 * Uses Node's built-in test runner, so there is nothing to install:
 *
 *     npm run build && npm test
 *
 * This is exactly what the module is for — matchRules takes no msg, no
 * flow/global context, no Node-RED runtime. It only needs to be given
 * already-resolved values, so the routing decision itself can be pinned down
 * here without standing up an editor or a running flow.
 */

const test = require('node:test');
const assert = require('node:assert');

const { matchRules } = require('../dist/lib/route-rules.js');

/** A minimal rule, since only operator/value/label matter to matchRules. */
function rule(operator, value, label) {
  return { operator, value, label };
}

test('first match wins when sendAllMatches is false', () => {
  const rules = [rule('equals', 'a', 'first'), rule('equals', 'a', 'second')];
  // Both rules would match "a" — only the first one's index comes back.
  assert.deepEqual(matchRules(rules, ['a', 'a'], false), [0]);
});

test('sendAllMatches returns every matching index, in rule order', () => {
  const rules = [rule('equals', 'a', 'A'), rule('contains', 'an', 'has-an'), rule('equals', 'b', 'B')];
  assert.deepEqual(matchRules(rules, ['a', 'banana', 'a'], true), [0, 1]);
});

test('no match returns the fixed output one past the last rule', () => {
  const rules = [rule('equals', 'a', 'A'), rule('equals', 'b', 'B')];
  assert.deepEqual(matchRules(rules, ['x', 'y'], false), [2]);
});

test('equals requires an exact match; contains checks for a substring', () => {
  const equalsRule = [rule('equals', 'invoice.pdf', 'Invoices')];
  assert.deepEqual(matchRules(equalsRule, ['invoice.pdf'], false), [0]);
  assert.deepEqual(
    matchRules(equalsRule, ['my-invoice.pdf'], false),
    [1],
    'equals must not match a substring the way contains does',
  );

  const containsRule = [rule('contains', 'invoice', 'Invoices')];
  assert.deepEqual(matchRules(containsRule, ['my-invoice.pdf'], false), [0]);
});

test('an empty rules array always routes to the (only) no-match output', () => {
  assert.deepEqual(matchRules([], [], false), [0]);
  assert.deepEqual(matchRules([], [], true), [0]);
});
