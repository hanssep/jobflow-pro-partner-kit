/**
 * Helpers for recording your node's work in a JobFlow Pro job.
 *
 * Copy this file into your own repository and change STEP_PREFIX. It is small on
 * purpose — the whole integration is "append a well-formed entry to an array
 * that is already on the message".
 *
 * Every function is a no-op when there is no job on the message, so the same
 * node works unchanged on plain Node-RED.
 */

import type { JobFlow, JobFlowMessage, JobStep } from '../jobflow.types';

/**
 * Prefixed to every step name so an operator can see which package produced a
 * line of job history, and so your steps can never collide with a built-in name.
 */
export const STEP_PREFIX = 'JFP Demo';

/**
 * Read the job off a message.
 *
 * Returns undefined when there is no job, when the message carries a fanned-out
 * array of jobs, or when the job has not been created yet — all cases where
 * recording a step would be wrong rather than merely unhelpful.
 */
export function getJob(msg: JobFlowMessage): JobFlow | undefined {
  const jobflow = msg?.jobflow;
  if (!jobflow || Array.isArray(jobflow) || typeof jobflow !== 'object') return undefined;
  if (!jobflow.jobID) return undefined;
  return jobflow;
}

/** True when this message belongs to a JobFlow Pro job. */
export function isTracked(msg: JobFlowMessage): boolean {
  return getJob(msg) !== undefined;
}

/**
 * Begin recording a step, and return it so you can complete it later.
 *
 * Call this before your work starts, so the step records the file you received
 * even if the work then fails.
 *
 * @returns the step to pass to endStep/failStep, or undefined when untracked.
 */
export function beginStep(msg: JobFlowMessage, name: string): JobStep | undefined {
  const job = getJob(msg);
  if (!job) return undefined;

  if (!Array.isArray(job.flow)) job.flow = [];

  const step: JobStep = {
    name: `${STEP_PREFIX}: ${name}`,
    inputFilePath: msg.filepath,
    time: new Date().toISOString(),
  };
  job.flow.push(step);
  return step;
}

/**
 * Complete a step successfully.
 *
 * The timestamp is refreshed here so it reflects when the work finished rather
 * than when it started.
 */
export function endStep(
  step: JobStep | undefined,
  result?: { outputFilePath?: string | string[]; properties?: Record<string, string> },
): void {
  if (!step) return;
  if (result?.outputFilePath) step.outputFilePath = result.outputFilePath;
  if (result?.properties) step.properties = { ...(step.properties ?? {}), ...result.properties };
  step.time = new Date().toISOString();
}

/**
 * Mark a step failed.
 *
 * Writes the error in the JSON-string form the dashboard parses, and marks the
 * job itself failed so its status in the Jobs list reflects the failure rather
 * than only the step's own row.
 *
 * Pass a plain English sentence. Your package has no entry in the dashboard's
 * translation catalogue, so a translation key would be shown literally.
 */
export function failStep(
  msg: JobFlowMessage,
  step: JobStep | undefined,
  message: string,
): void {
  // The dashboard runs JSON.parse on this field and reads `.error` from the
  // result, so it has to be a JSON string rather than the message itself.
  const encoded = JSON.stringify({ error: message });

  if (step) {
    step.error = encoded;
    step.time = new Date().toISOString();
  }

  const job = getJob(msg);
  if (job) job.error = encoded;
}
