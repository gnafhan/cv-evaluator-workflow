import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { DocumentsService } from '../documents/documents.service';
import { EvaluateRequestDto } from './dto/evaluate-request.dto';
import { ResultResponseDto } from './dto/result-response.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Controller()
export class EvaluationController {
  constructor(
    private readonly evaluationService: EvaluationService,
    private readonly documentsService: DocumentsService,
    @InjectQueue('evaluation-jobs') private evaluationQueue: Queue,
  ) {}

  @Post('evaluate')
  @HttpCode(HttpStatus.ACCEPTED)
  async evaluate(@Body() dto: EvaluateRequestDto) {
    // Verify documents exist
    await this.documentsService.getDocumentById(dto.cv_id);
    await this.documentsService.getDocumentById(dto.project_report_id);

    // Create job
    const jobId = await this.evaluationService.createJob(
      dto.job_title,
      dto.cv_id,
      dto.project_report_id,
    );

    // Enqueue job
    await this.evaluationQueue.add('evaluate', {
      job_id: jobId,
      job_title: dto.job_title,
      cv_id: dto.cv_id,
      project_report_id: dto.project_report_id,
    });

    return {
      id: jobId,
      status: 'queued',
      created_at: new Date(),
    };
  }

  @Get('result/:id')
  async getResult(@Param('id') id: string): Promise<ResultResponseDto> {
    const job = await this.evaluationService.getJobById(id);

    const response: ResultResponseDto = {
      id: job.job_id,
      status: job.status,
      current_stage: job.current_stage,
      progress_percentage: job.progress_percentage,
      created_at: job.createdAt || new Date(),
      started_at: job.started_at,
      completed_at: job.completed_at,
    };

    if (job.status === 'completed' && job.result) {
      response.result = job.result as any;
      if (job.started_at && job.completed_at) {
        response.processing_time_seconds = Math.floor(
          (job.completed_at.getTime() - job.started_at.getTime()) / 1000,
        );
      }
    }

    if (job.status === 'failed' && job.error) {
      response.error = job.error as any;
      response.retry_possible = true;
    }

    return response;
  }
}

