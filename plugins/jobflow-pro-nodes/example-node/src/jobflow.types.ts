/**
 * The JobFlow Pro message contract.
 *
 * COPY THIS FILE INTO YOUR OWN REPOSITORY. There is nothing to install: job
 * tracking works by adding to an object that is already travelling on the
 * message, so your package has no dependency on JobFlow Pro at all.
 *
 * HOW JOB TRACKING ACTUALLY WORKS
 * A JobFlow Pro job carries its own history as an array of steps on
 * `msg.jobflow.flow`. Every time a JobFlow Pro node reports progress, it writes
 * that entire array to the job record — so an entry your node appends is picked
 * up and stored by the next JobFlow Pro node that runs after yours.
 *
 * That is the whole mechanism, and it is why this needs no product changes.
 *
 * WHAT IT MEANS FOR YOU
 *  - Your node must sit downstream of a JobFlow Pro input node (hot folder or
 *    drop zone). Those create the job; your node adds to it.
 *  - At least one JobFlow Pro node must run after yours for your step to be
 *    saved. In practice `flow-end` at the end of the flow is enough.
 *  - Your step appears once that later node reports — not the instant your node
 *    runs. There is no live progress for third-party nodes.
 */

/**
 * One entry in a job's history. Each becomes a row in the job-details timeline.
 */
export interface JobStep {
  /**
   * Shown as the step's title. Prefix it with your package or product name so an
   * operator can tell it apart from built-in steps.
   *
   * Never use the exact name `flow-end` — the dashboard filters that string out
   * of the timeline and your step would silently vanish.
   */
  name: string;

  /** Absolute path to the file this step received. */
  inputFilePath?: string | string[];

  /** Absolute path to the file this step produced, if any. */
  outputFilePath?: string | string[];

  /** Key/value pairs shown under the step. Use plain strings for the values. */
  properties?: Record<string, unknown>;

  /**
   * A JSON STRING, not a sentence: `JSON.stringify({ error: 'What went wrong' })`.
   *
   * The dashboard runs `JSON.parse` on this field and reads `.error` off the
   * result. Plain text throws inside its parser and the step renders with an
   * empty error badge, so the operator sees that something failed but not what.
   */
  error?: string;

  /** ISO 8601 timestamp. Always set it — the dashboard reads it for step times. */
  time?: string;
}

/**
 * The job itself. Treat every field except `flow` as read-only: JobFlow Pro owns
 * them, and writing to them can corrupt the job record.
 */
export interface JobFlow {
  /** Present once a JobFlow Pro input node has created the job. */
  jobID?: string;
  /** The job's history. This is the one field you append to. */
  flow?: JobStep[];
  /** Job-level properties, shown in the job summary. */
  properties?: Record<string, unknown>;
  /** When set, the next JobFlow Pro node marks the whole job failed. */
  error?: string;
  flowName?: string;
  source?: string;
  workflow?: string;
}

/**
 * A Node-RED message inside a JobFlow Pro flow.
 *
 * `jobflow` is an array when an upstream node fanned one job into several. Most
 * nodes should decline that case rather than guess which element was meant.
 */
export interface JobFlowMessage {
  jobflow?: JobFlow | JobFlow[];
  /** Absolute path to the file being processed. */
  filepath?: string | string[];
  /** Bare file name. */
  filename?: string;
  [key: string]: unknown;
}
