/**
 * jfpdemo-route — a router with a dynamic number of outputs.
 *
 * Demonstrates three patterns third-party nodes commonly need:
 *
 *   - a configurable number of outputs, driven by a hidden `outputs` field
 *     the editor writes on save (see Route.html)
 *   - resolving a TypedInput field (msg/flow/global/env/literal) at runtime
 *     with RED.util.evaluateNodeProperty, rather than hand-rolling it
 *   - fanning one message out to several outputs safely with
 *     RED.util.cloneMessage
 *
 * The actual rule-matching logic lives in ../../lib/route-rules.ts as a
 * pure, Node-RED-free module — this file only resolves inputs and wires the
 * result up to send().
 */

import type { Node, NodeAPI, NodeDef } from 'node-red';

import type { JobFlowMessage } from '../../jobflow.types';
import { beginStep, endStep, failStep } from '../../lib/jobflow';
import { matchRules, type RouteRule } from '../../lib/route-rules';

const NODE_TYPE = 'jfpdemo-route';

/** A configured rule, as it comes off the editor: the pure RouteRule shape plus where to read its value from. */
interface RouteRuleDef extends RouteRule {
  /** TypedInput value, e.g. a msg property path such as `filename`. */
  property: string;
  /** TypedInput type, e.g. `msg` or `str`. */
  propertyType: string;
}

interface RouteNodeDef extends NodeDef {
  rules: RouteRuleDef[];
  sendAllMatches: boolean;
}

module.exports = function (RED: NodeAPI) {
  function RouteNode(this: Node, config: RouteNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;
    const rules: RouteRuleDef[] = Array.isArray(config.rules) ? config.rules : [];
    const sendAllMatches = !!config.sendAllMatches;
    const noMatchOutput = rules.length; // the fixed output one past the last rule

    node.on('input', (msg: JobFlowMessage, send, done) => {
      // A router doesn't read files, so unlike Transform/Validate there is
      // no filepath guard here — it only inspects whatever property each
      // rule points at, and it works whether or not a filepath is present.
      const step = beginStep(msg, 'Route');

      try {
        // RED.util.evaluateNodeProperty is how a TypedInput field resolves
        // msg/flow/global/env correctly — never hand-roll that lookup, it is
        // easy to get context stores or dotted paths subtly wrong. Each rule
        // has its own property, so it is resolved once per rule here.
        const resolvedValues = rules.map((rule) => {
          const resolved = RED.util.evaluateNodeProperty(rule.property, rule.propertyType, node, msg);
          return resolved === undefined || resolved === null ? '' : String(resolved);
        });

        const matchedIndexes = matchRules(rules, resolvedValues, sendAllMatches);
        const matched = matchedIndexes[0] !== noMatchOutput;

        const outputs: Array<JobFlowMessage | null> = new Array(rules.length + 1).fill(null);
        for (const index of matchedIndexes) {
          outputs[index] = msg;
        }

        // Within a single send() call the runtime delivers the first
        // populated slot by reference and deep-clones every later one, so
        // the same msg object in several slots is safe here. That guarantee
        // is PER CALL: fanning out with separate send() calls clones
        // nothing — there, clone each copy yourself with
        // RED.util.cloneMessage before sending it.

        const label = matched
          ? matchedIndexes.map((i) => rules[i].label || `rule ${i + 1}`).join(', ')
          : undefined;

        endStep(step, {
          properties: { matched: label ?? 'none', outputs: String(matchedIndexes.length) },
        });

        if (label) {
          // RED._ interpolates __var__ tokens in the locale string. Note
          // that i18next's default {{var}} syntax is NOT active in
          // Node-RED — a {{...}} placeholder would render literally, with
          // no error.
          node.status({ fill: 'green', shape: 'dot', text: RED._('jfpdemo-route.status.routed', { label }) });
        } else {
          node.status({ fill: 'yellow', shape: 'ring', text: `${NODE_TYPE}.status.noMatch` });
        }

        send(outputs);
        done();
      } catch (error: any) {
        // A fault (a malformed rule expression), not a business outcome —
        // record it against the job, then let Node-RED handle the error.
        failStep(msg, step, `Route failed: ${error.message}`);
        node.status({ fill: 'red', shape: 'dot', text: `${NODE_TYPE}.error.routeFailed` });
        done(error);
      }
    });

    node.on('close', () => {
      node.status({});
    });
  }

  RED.nodes.registerType(NODE_TYPE, RouteNode);
};
