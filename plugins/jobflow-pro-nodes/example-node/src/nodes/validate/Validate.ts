/**
 * jfpdemo-validate — a checking node with pass and fail outputs.
 *
 * Shows two things the transform node does not:
 *
 *   - a step that records a business outcome ("failed validation") rather than a
 *     crash. The job is marked failed and the reason reaches job details, but the
 *     node itself did not error, so the flow keeps control and routes the message
 *     down its second output.
 *   - recording useful properties on the step, which is what makes job details
 *     worth opening.
 */

import type { Node, NodeAPI, NodeDef } from 'node-red';
import fs from 'fs';

import type { JobFlowMessage } from '../../jobflow.types';
import { beginStep, endStep, failStep } from '../../lib/jobflow';

const NODE_TYPE = 'jfpdemo-validate';

interface ValidateNodeDef extends NodeDef {
  /** Reject files larger than this, in bytes. */
  maxBytes: string;
}

module.exports = function (RED: NodeAPI) {
  function ValidateNode(this: Node, config: ValidateNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.on('input', async (msg: JobFlowMessage, send, done) => {
      const maxBytes = Number(config.maxBytes) > 0 ? Number(config.maxBytes) : 1024 * 1024;

      node.status({ fill: 'blue', shape: 'dot', text: `${NODE_TYPE}.status.checking` });

      const step = beginStep(msg, 'Validate');

      try {
        if (Array.isArray(msg.filepath)) {
          throw new Error('This node handles one file at a time.');
        }
        const filePath = msg.filepath;
        if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
          throw new Error('No input file on the message.');
        }

        const { size } = fs.statSync(filePath);
        const withinLimit = size <= maxBytes;

        if (withinLimit) {
          endStep(step, {
            properties: { bytes: String(size), limit: String(maxBytes), result: 'passed' },
          });
          node.status({ fill: 'green', shape: 'dot', text: `${NODE_TYPE}.status.passed` });
          send([msg, null]);
          done();
          return;
        }

        // A rejected file is an expected outcome, not a crash. Record it against
        // the job, then route it out of the failure output and let the flow
        // decide what to do next.
        endStep(step, {
          properties: { bytes: String(size), limit: String(maxBytes), result: 'failed' },
        });
        failStep(msg, step, `File is ${size} bytes, over the ${maxBytes} byte limit.`);

        node.status({ fill: 'yellow', shape: 'ring', text: `${NODE_TYPE}.status.rejected` });
        send([null, msg]);
        done();
      } catch (error: any) {
        failStep(msg, step, `Validation could not run: ${error.message}`);
        node.status({ fill: 'red', shape: 'dot', text: `${NODE_TYPE}.error.checkFailed` });
        done(error);
      }
    });

    node.on('close', () => {
      node.status({});
    });
  }

  RED.nodes.registerType(NODE_TYPE, ValidateNode);
};
