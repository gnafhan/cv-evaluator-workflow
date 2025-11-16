import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EvaluationJobDocument = HydratedDocument<EvaluationJob>;

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

@Schema({ timestamps: true })
export class EvaluationInput {
  @Prop({ required: true })
  job_title: string;

  @Prop({ required: true })
  cv_id: string;

  @Prop({ required: true })
  project_report_id: string;
}

@Schema({ timestamps: true })
export class ScoringBreakdown {
  @Prop({ type: Object })
  technical_skills_match?: {
    score: number;
    weight: number;
    weighted_score: number;
  };

  @Prop({ type: Object })
  experience_level?: {
    score: number;
    weight: number;
    weighted_score: number;
  };

  @Prop({ type: Object })
  relevant_achievements?: {
    score: number;
    weight: number;
    weighted_score: number;
  };

  @Prop({ type: Object })
  cultural_fit?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
}

@Schema({ timestamps: true })
export class ProjectScoringBreakdown {
  @Prop({ type: Object })
  correctness?: {
    score: number;
    weight: number;
    weighted_score: number;
  };

  @Prop({ type: Object })
  code_quality?: {
    score: number;
    weight: number;
    weighted_score: number;
  };

  @Prop({ type: Object })
  resilience?: {
    score: number;
    weight: number;
    weighted_score: number;
  };

  @Prop({ type: Object })
  documentation?: {
    score: number;
    weight: number;
    weighted_score: number;
  };

  @Prop({ type: Object })
  creativity?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
}

@Schema({ timestamps: true })
export class EvaluationResult {
  @Prop({ required: true })
  cv_match_rate: number;

  @Prop({ required: true })
  cv_feedback: string;

  @Prop({ type: ScoringBreakdown })
  cv_scoring_breakdown: ScoringBreakdown;

  @Prop({ required: true })
  cv_recommendation: string;

  @Prop({ required: true })
  project_score: number;

  @Prop({ required: true })
  project_feedback: string;

  @Prop({ type: ProjectScoringBreakdown })
  project_scoring_breakdown: ProjectScoringBreakdown;

  @Prop({ required: true })
  project_recommendation: string;

  @Prop({ required: true })
  overall_summary: string;
}

@Schema({ timestamps: true })
export class EvaluationError {
  @Prop({ required: true })
  code: string;

  @Prop({ required: true })
  message: string;

  @Prop()
  stage?: string;

  @Prop({ required: true })
  timestamp: Date;
}

@Schema({ timestamps: true })
export class EvaluationMetadata {
  @Prop({ default: 0 })
  llm_calls_count: number;

  @Prop({ default: 0 })
  total_tokens_used: number;

  @Prop({ default: 0 })
  processing_time_ms: number;

  @Prop({ default: 0 })
  retry_count: number;
}

@Schema({ timestamps: true })
export class EvaluationJob {
  @Prop({ required: true, unique: true, index: true })
  job_id: string;

  @Prop({
    required: true,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
    index: true,
  })
  status: JobStatus;

  @Prop()
  current_stage?: string;

  @Prop({ default: 0, min: 0, max: 100 })
  progress_percentage: number;

  @Prop({ type: EvaluationInput, required: true })
  input: EvaluationInput;

  @Prop({ type: EvaluationResult })
  result?: EvaluationResult;

  @Prop({ type: EvaluationError })
  error?: EvaluationError;

  @Prop({ type: EvaluationMetadata, default: () => ({}) })
  metadata: EvaluationMetadata;

  @Prop()
  started_at?: Date;

  @Prop()
  completed_at?: Date;

  // Mongoose timestamps (automatically added by timestamps: true)
  createdAt?: Date;
  updatedAt?: Date;
}

export const EvaluationJobSchema =
  SchemaFactory.createForClass(EvaluationJob);

