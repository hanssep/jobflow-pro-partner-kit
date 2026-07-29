/**
 * jfpdemo-transform — a processing node that records its work in the job.
 *
 * The shape every JobFlow Pro-aware processing node follows:
 *
 *   1. read the file from msg.filepath (never from msg.payload)
 *   2. beginStep() before the work
 *   3. do the work, writing output to disk
 *   4. endStep() with the output path, or failStep() with a plain message
 *   5. send the message on
 *
 * Steps 2 and 4 are no-ops outside JobFlow Pro, so this same node runs on plain
 * Node-RED without any conditional code.
 */

import type { Node, NodeAPI, NodeDef } from 'node-red';
import fs from 'fs';
import path from 'path';

import type { JobFlowMessage } from '../../jobflow.types';
import { beginStep, endStep, failStep } from '../../lib/jobflow';

const NODE_TYPE = 'jfpdemo-transform';

interface TransformNodeDef extends NodeDef {
  /** Text appended to the file, standing in for real processing work. */
  suffix: string;
}

module.exports = function (RED: NodeAPI) {
  function TransformNode(this: Node, config: TransformNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.on('input', async (msg: JobFlowMessage, send, done) => {
      const suffix = config.suffix || '\n-- transformed --\n';

      node.status({ fill: 'blue', shape: 'dot', text: `${NODE_TYPE}.status.working` });

      // Record the step before doing anything, so a failure still shows which
      // file this node was given.
      const step = beginStep(msg, 'Transform');

      try {
        // JobFlow Pro passes files by path. Handle the array case explicitly
        // rather than silently processing the first element and losing the rest.
        if (Array.isArray(msg.filepath)) {
          throw new Error('This node handles one file at a time.');
        }
        const filePath = msg.filepath;
        if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
          throw new Error('No input file on the message.');
        }

        fs.appendFileSync(filePath, suffix, 'utf8');
        const { size } = fs.statSync(filePath);

        endStep(step, {
          outputFilePath: filePath,
          properties: { bytes: String(size) },
        });

        node.status({ fill: 'green', shape: 'dot', text: `${NODE_TYPE}.status.done` });
        send(msg);
        done();
      } catch (error: any) {
        // Record the failure in the job, then let Node-RED handle the error.
        failStep(msg, step, `Transform failed on ${basename(msg.filepath)}: ${error.message}`);
        node.status({ fill: 'red', shape: 'dot', text: `${NODE_TYPE}.error.transformFailed` });
        done(error);
      }
    });

    node.on('close', () => {
      node.status({});
    });
  }

  /** Best-effort file name for an error message, whatever shape filepath is in. */
  function basename(filepath: string | string[] | undefined): string {
    const single = Array.isArray(filepath) ? filepath[0] : filepath;
    return typeof single === 'string' ? path.basename(single) : 'the input';
  }

  RED.nodes.registerType(NODE_TYPE, TransformNode);
};
