/**
 * Pure rule-matching logic for jfpdemo-route.
 *
 * Exit-code/rule interpretation logic like this belongs in a small pure
 * module so it is unit-testable without Node-RED — the node file only wires
 * it up (resolve each rule's configured property, call this, build the
 * outputs array from the result).
 *
 * This file knows nothing about msg, flow context, or TypedInput. It only
 * knows about the result of resolving those things: a plain string per rule.
 */

export interface RouteRule {
  operator: 'equals' | 'contains';
  value: string;
  label: string;
}

/**
 * Which outputs a message should be sent to.
 *
 * `resolvedValues` holds one already-resolved string per rule, in the same
 * order as `rules` — because each rule configures its own property (see
 * Route.ts), a single shared value cannot be tested against every rule; the
 * caller resolves each rule's property before calling in here.
 *
 * Returns the matching rule indexes, or `[rules.length]` — the fixed "no
 * match" output that always exists one past the last rule — when nothing
 * matches (including when `rules` is empty).
 *
 * When `sendAllMatches` is false, only the first matching rule's index is
 * returned, even if later rules would also match.
 */
export function matchRules(rules: RouteRule[], resolvedValues: string[], sendAllMatches: boolean): number[] {
  const matches: number[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const resolved = resolvedValues[i] ?? '';
    const matched = rule.operator === 'contains' ? resolved.includes(rule.value) : resolved === rule.value;
    if (!matched) continue;

    matches.push(i);
    if (!sendAllMatches) break;
  }

  return matches.length > 0 ? matches : [rules.length];
}
