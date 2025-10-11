import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  register,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private jobCounter: Counter<string>;
  private jobDuration: Histogram<string>;
  private queueDepth: Gauge<string>;
  private activeJobs: Gauge<string>;
  private errorCounter: Counter<string>;
  private creditUsage: Counter<string>;
  private static defaultMetricsCollected = false;

  constructor() {
    // Initialize custom metrics
    this.initializeMetrics();
  }

  onModuleInit() {
    // Collect default metrics only once
    if (!MetricsService.defaultMetricsCollected) {
      try {
        collectDefaultMetrics({ register });
        MetricsService.defaultMetricsCollected = true;
      } catch (error) {
        console.warn('Failed to collect default metrics:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }

  private initializeMetrics() {
    // Check if metrics already exist to avoid duplicate registration
    const existingCounter = register.getSingleMetric('jobs_total');
    if (existingCounter) {
      this.jobCounter = existingCounter as Counter<string>;
    } else {
      this.jobCounter = new Counter({
        name: 'jobs_total',
        help: 'Total number of jobs processed',
        labelNames: ['type', 'status', 'provider'],
        registers: [register],
      });
    }

    // Job duration histogram
    const existingDuration = register.getSingleMetric('job_duration_seconds');
    if (existingDuration) {
      this.jobDuration = existingDuration as Histogram<string>;
    } else {
      this.jobDuration = new Histogram({
        name: 'job_duration_seconds',
        help: 'Job processing duration in seconds',
        labelNames: ['type', 'status', 'provider'],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
        registers: [register],
      });
    }

    // Queue depth gauge
    const existingQueueDepth = register.getSingleMetric('queue_depth');
    if (existingQueueDepth) {
      this.queueDepth = existingQueueDepth as Gauge<string>;
    } else {
      this.queueDepth = new Gauge({
        name: 'queue_depth',
        help: 'Number of jobs in queue',
        labelNames: ['queue_name'],
        registers: [register],
      });
    }

    // Active jobs gauge
    const existingActiveJobs = register.getSingleMetric('active_jobs');
    if (existingActiveJobs) {
      this.activeJobs = existingActiveJobs as Gauge<string>;
    } else {
      this.activeJobs = new Gauge({
        name: 'active_jobs',
        help: 'Number of currently processing jobs',
        labelNames: ['type'],
        registers: [register],
      });
    }

    // Error counter
    const existingErrorCounter = register.getSingleMetric('job_errors_total');
    if (existingErrorCounter) {
      this.errorCounter = existingErrorCounter as Counter<string>;
    } else {
      this.errorCounter = new Counter({
        name: 'job_errors_total',
        help: 'Total number of job errors',
        labelNames: ['type', 'error_type', 'provider'],
        registers: [register],
      });
    }

    // Credit usage counter
    const existingCreditUsage = register.getSingleMetric('credits_used_total');
    if (existingCreditUsage) {
      this.creditUsage = existingCreditUsage as Counter<string>;
    } else {
      this.creditUsage = new Counter({
        name: 'credits_used_total',
        help: 'Total credits used',
        labelNames: ['user_id', 'job_type', 'provider'],
        registers: [register],
      });
    }
  }

  // Job metrics
  recordJobStart(jobType: string, provider: string) {
    this.activeJobs.inc({ type: jobType });
    this.jobCounter.inc({ type: jobType, status: 'started', provider });
  }

  recordJobComplete(jobType: string, provider: string, duration: number) {
    this.activeJobs.dec({ type: jobType });
    this.jobCounter.inc({ type: jobType, status: 'completed', provider });
    this.jobDuration.observe(
      { type: jobType, status: 'completed', provider },
      duration,
    );
  }

  recordJobError(
    jobType: string,
    provider: string,
    errorType: string,
    duration: number,
  ) {
    this.activeJobs.dec({ type: jobType });
    this.jobCounter.inc({ type: jobType, status: 'failed', provider });
    this.errorCounter.inc({ type: jobType, error_type: errorType, provider });
    this.jobDuration.observe(
      { type: jobType, status: 'failed', provider },
      duration,
    );
  }

  // Queue metrics
  setQueueDepth(queueName: string, depth: number) {
    this.queueDepth.set({ queue_name: queueName }, depth);
  }

  // Credit metrics
  recordCreditUsage(
    userId: string,
    jobType: string,
    provider: string,
    credits: number,
  ) {
    this.creditUsage.inc(
      { user_id: userId, job_type: jobType, provider },
      credits,
    );
  }

  // Get all metrics
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  // Get specific metric
  async getMetric(name: string): Promise<string> {
    return register.getSingleMetricAsString(name);
  }
}
