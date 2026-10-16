import { parseResumeJob, parseResumeFailed } from "../services/resume";
import { analyzeRepoJob, analyzeRepoFailed } from "../services/repos";
import { evaluateRoundJob, evaluateRoundFailed, combinedReportJob, combinedReportFailed } from "../services/evaluation";
import { proctorCheckJob } from "../services/proctor";
import { deliverWebhookFailed, deliverWebhookJob } from "../services/integrations";

type Handler = (payload: Record<string, unknown>) => Promise<void>;

/** Job type → handler. `<type>:failed` handlers run once after the final failed attempt. */
export const handlers: Record<string, Handler> = {
  "parse-resume": (p) => parseResumeJob(p as { resumeId: string }),
  "parse-resume:failed": (p) => parseResumeFailed(p as { resumeId: string }),
  "analyze-repo": (p) => analyzeRepoJob(p as { repositoryId: string }),
  "analyze-repo:failed": (p) => analyzeRepoFailed(p as { repositoryId: string }),
  "evaluate-round": (p) => evaluateRoundJob(p as { sessionId: string }),
  "evaluate-round:failed": (p) => evaluateRoundFailed(p as { sessionId: string; error?: string }),
  "combined-report": (p) => combinedReportJob(p as { candidacyId: string }),
  "combined-report:failed": (p) => combinedReportFailed(p as { candidacyId: string; error?: string }),
  "proctor-check": (p) => proctorCheckJob(p as { snapshotId: string }),
  "deliver-webhook": (p) => deliverWebhookJob(p as { deliveryId: string }),
  "deliver-webhook:failed": (p) => deliverWebhookFailed(p as { deliveryId: string }),
};
