/* eslint-disable @typescript-eslint/no-explicit-any */
import { createLogger } from "../core/logger.js";
import { type Credential } from "../core/engine.js";
import { type SiteConfig } from "../targets/index.js";

const log = createLogger("Coordinator");

export interface WorkerJob {
  jobId: string;
  cred: Credential;
  site: SiteConfig;
  batchIndex: number;
  proxyKey?: string;
  ignitionVerifBypass?: boolean;
}

export interface WorkerResult {
  jobId: string;
  outcome: string;
  attempts: number;
  reason?: string;
  misdirection?: any;
  requeueCredential?: boolean;
  bypassCashierVerification?: boolean;
}

/**
 * The Coordinator manages pushing jobs to the distributed queue (Redis/NATS)
 * and listening for completed results from Workers.
 */
export class DistributedCoordinator {
  private pendingJobs = new Map<string, { resolve: (res: WorkerResult) => void; reject: (err: any) => void }>();

  constructor() {
    // In a real implementation, connect to Redis/NATS here
  }

  public async dispatchJob(job: WorkerJob): Promise<WorkerResult> {
    log.info(`[Coordinator] Dispatching job ${job.jobId} for ${job.site.name}`);
    return new Promise((resolve, reject) => {
      this.pendingJobs.set(job.jobId, { resolve, reject });
      
      // MOCK: Simulate immediate push to queue
      this.publishToQueue(job);
    });
  }

  private publishToQueue(job: WorkerJob) {
    // In a real implementation, this would be: redisClient.xadd('jobs_stream', '*', 'data', JSON.stringify(job));
    log.debug(`[Coordinator] Job ${job.jobId} published to stream`);
  }

  public handleWorkerResult(result: WorkerResult) {
    log.info(`[Coordinator] Received result for job ${result.jobId}: ${result.outcome}`);
    const pending = this.pendingJobs.get(result.jobId);
    if (pending) {
      pending.resolve(result);
      this.pendingJobs.delete(result.jobId);
    }
  }
}

export const coordinator = new DistributedCoordinator();
