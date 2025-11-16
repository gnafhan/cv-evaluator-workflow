export interface ScoringBreakdownDto {
  technical_skills_match?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  experience_level?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  relevant_achievements?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  cultural_fit?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
}

export interface ProjectScoringBreakdownDto {
  correctness?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  code_quality?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  resilience?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  documentation?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  creativity?: {
    score: number;
    weight: number;
    weighted_score: number;
  };
}

export interface EvaluationResultDto {
  cv_match_rate: number;
  cv_feedback: string;
  cv_recommendation: string;
  cv_scoring_breakdown: ScoringBreakdownDto;
  project_score: number;
  project_feedback: string;
  project_recommendation: string;
  project_scoring_breakdown: ProjectScoringBreakdownDto;
  overall_summary: string;
}

export interface EvaluationErrorDto {
  code: string;
  message: string;
  stage?: string;
  timestamp: Date;
}

export class ResultResponseDto {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  current_stage?: string;
  progress_percentage: number;
  result?: EvaluationResultDto;
  error?: EvaluationErrorDto;
  retry_possible?: boolean;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  processing_time_seconds?: number;
}

