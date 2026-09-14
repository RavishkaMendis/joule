// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API — screens and the Today indicator should import from here
// (`../lib/captureJobs`) rather than reaching into individual files.
// ═══════════════════════════════════════════════════════════════════════

export type { CaptureJob, CaptureJobInput, CaptureJobKind, CaptureJobStatus } from './types';
export { captureJobKindLabel, describeJob } from './jobReducer';
export { describeFailedJobPrompt, jobTapAction, type FailedJobPrompt, type JobTapAction } from './jobPrompt';
export { captureJobSourceExists } from './runner';
export { dismissJob, getJob, initCaptureJobsRuntime, retryJob, submitJob } from './store';
export { useCaptureJob, useCaptureJobsList, useWatchCaptureJob } from './useCaptureJob';
