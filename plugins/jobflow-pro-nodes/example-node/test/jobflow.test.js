/**
 * Tests for the job-tracking helpers.
 *
 * Uses Node's built-in test runner, so there is nothing to install:
 *
 *     npm run build && npm test
 *
 * These assert the SHAPE of what gets appended to msg.jobflow.flow, because that
 * shape is what the JobFlow Pro dashboard reads. In particular the error field
 * has to survive `JSON.parse(...).error`, which is exactly what the dashboard
 * does to it — plain text there renders an empty error badge.
 */

const test = require('node:test');
const assert = require('node:assert');

const { getJob, isTracked, beginStep, endStep, failStep, STEP_PREFIX } = require('../dist/lib/jobflow.js');

/** A message as it arrives from an upstream JobFlow Pro node. */
function trackedMessage() {
  return {
    filepath: '/jobs/job-1/input.pdf',
    filename: 'input.pdf',
    jobflow: { jobID: 'job-1', flowName: 'Hot folder', flow: [{ name: 'Hot folder' }] },
  };
}

test('getJob returns the job on a tracked message', () => {
  assert.equal(getJob(trackedMessage()).jobID, 'job-1');
  assert.equal(isTracked(trackedMessage()), true);
});

test('getJob declines messages that carry no usable job', () => {
  assert.equal(getJob({}), undefined);
  assert.equal(getJob({ jobflow: {} }), undefined, 'a job without an id is not usable');
  assert.equal(
    getJob({ jobflow: [{ jobID: 'a' }, { jobID: 'b' }] }),
    undefined,
    'a fanned-out array is ambiguous and must not be guessed at',
  );
  assert.equal(isTracked({}), false);
});

test('beginStep appends one prefixed step carrying the input file', () => {
  const msg = trackedMessage();
  const step = beginStep(msg, 'Transform');

  assert.equal(msg.jobflow.flow.length, 2, 'the upstream step is preserved');
  assert.equal(msg.jobflow.flow[1], step);
  assert.equal(step.name, `${STEP_PREFIX}: Transform`);
  assert.equal(step.inputFilePath, '/jobs/job-1/input.pdf');
  assert.ok(!Number.isNaN(Date.parse(step.time)), 'time is an ISO timestamp');
});

test('beginStep never uses the reserved flow-end name', () => {
  const msg = trackedMessage();
  const step = beginStep(msg, 'flow-end');
  // The dashboard filters entries named exactly 'flow-end' out of the timeline,
  // so the prefix is what stops a step from silently disappearing.
  assert.notEqual(step.name, 'flow-end');
  assert.ok(step.name.startsWith(STEP_PREFIX));
});

test('beginStep is a no-op outside JobFlow Pro', () => {
  const msg = { filepath: '/tmp/x.pdf' };
  assert.equal(beginStep(msg, 'Transform'), undefined);
  assert.deepEqual(msg, { filepath: '/tmp/x.pdf' }, 'the message is left alone');
});

test('endStep records the output and merges properties', () => {
  const msg = trackedMessage();
  const step = beginStep(msg, 'Transform');
  const startedAt = step.time;

  endStep(step, { outputFilePath: '/jobs/job-1/out.pdf', properties: { bytes: '42' } });

  assert.equal(step.outputFilePath, '/jobs/job-1/out.pdf');
  assert.deepEqual(step.properties, { bytes: '42' });
  assert.ok(Date.parse(step.time) >= Date.parse(startedAt), 'time reflects completion');
});

test('endStep tolerates an absent step so callers need no null checks', () => {
  assert.doesNotThrow(() => endStep(undefined, { properties: { a: 'b' } }));
});

test('failStep writes an error the dashboard can actually parse', () => {
  const msg = trackedMessage();
  const step = beginStep(msg, 'Transform');

  failStep(msg, step, 'File is 900 bytes, over the 500 byte limit.');

  // This is precisely what job-summary does: JSON.parse the string, read .error.
  const parsed = JSON.parse(step.error);
  assert.equal(parsed.error, 'File is 900 bytes, over the 500 byte limit.');

  // The job itself is marked failed, so the Jobs list shows the failure too.
  assert.equal(JSON.parse(msg.jobflow.error).error, parsed.error);
});

test('failStep is a no-op outside JobFlow Pro', () => {
  const msg = { filepath: '/tmp/x.pdf' };
  assert.doesNotThrow(() => failStep(msg, undefined, 'boom'));
  assert.deepEqual(msg, { filepath: '/tmp/x.pdf' });
});

test('the recorded history survives a round trip through the job record', () => {
  const msg = trackedMessage();
  const step = beginStep(msg, 'Transform');
  endStep(step, { outputFilePath: '/jobs/job-1/out.pdf', properties: { bytes: '42' } });

  // A downstream JobFlow Pro node serializes the whole array into the job's
  // `nodes` column; the dashboard parses it back. Anything not JSON-safe here
  // would be lost between those two points.
  const restored = JSON.parse(JSON.stringify(msg.jobflow.flow));

  assert.deepEqual(restored, msg.jobflow.flow);
  assert.equal(restored[1].name, `${STEP_PREFIX}: Transform`);
  assert.equal(restored[1].properties.bytes, '42');
});
