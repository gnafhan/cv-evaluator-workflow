import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EvaluationService } from '../evaluation.service';

export interface EvaluationJobData {
  job_id: string;
  job_title: string;
  cv_id: string;
  project_report_id: string;
}

@Processor('evaluation-jobs')
export class EvaluationProcessor extends WorkerHost {
  private readonly logger = new Logger(EvaluationProcessor.name);

  constructor(private readonly evaluationService: EvaluationService) {
    super();
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Processing job ${job.id}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  async process(job: Job<EvaluationJobData>) {
    const { job_id, job_title, cv_id, project_report_id } = job.data;
    const startTime = Date.now();

    try {
      // Update job status
      await this.evaluationService.updateJobProgress(job_id, 10, 'cv_parsing');

      // Stage 1: Parse CV
      const cvData = await this.evaluationService.parseCV(cv_id);
      await this.evaluationService.updateJobProgress(job_id, 30, 'cv_evaluation');

      // Stage 2: Evaluate CV
      const cvResult = await this.evaluationService.evaluateCV(
        cvData,
        job_title,
      );
      await this.evaluationService.updateJobProgress(
        job_id,
        50,
        'project_parsing',
      );

      // Stage 3: Parse Project
      const projectData =
        await this.evaluationService.parseProject(project_report_id);
      await this.evaluationService.updateJobProgress(
        job_id,
        65,
        'project_evaluation',
      );

      // Stage 4: Evaluate Project
      const projectResult =
        await this.evaluationService.evaluateProject(projectData);
      await this.evaluationService.updateJobProgress(job_id, 85, 'final_analysis');

      // Stage 5: Synthesize Results
      const overallSummary = await this.evaluationService.synthesizeResults(
        cvResult,
        projectResult,
      );
      await this.evaluationService.updateJobProgress(job_id, 95, 'completing');

      // Combine results
      const result = {
        cv_match_rate: cvResult.cv_match_rate,
        cv_feedback: cvResult.cv_feedback,
        cv_scoring_breakdown: cvResult.cv_scoring_breakdown,
        project_score: projectResult.project_score,
        project_feedback: projectResult.project_feedback,
        project_scoring_breakdown: projectResult.project_scoring_breakdown,
        overall_summary: overallSummary,
      };

      // Complete job
      await this.evaluationService.completeJob(job_id, result);

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `Job ${job_id} completed in ${processingTime}ms`,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`Job ${job_id} failed: ${error.message}`, error.stack);
      
      // Determine current stage from error context
      let stage = 'unknown';
      if (error.message?.includes('CV')) {
        stage = 'cv_evaluation';
      } else if (error.message?.includes('Project')) {
        stage = 'project_evaluation';
      }

      await this.evaluationService.failJob(job_id, error, stage);
      throw error;
    }
  }
}

