export interface CVEvaluationOutput {
  technical_skills_match: {
    score: number;
    reasoning: string;
  };
  experience_level: {
    score: number;
    reasoning: string;
  };
  relevant_achievements: {
    score: number;
    reasoning: string;
  };
  cultural_fit: {
    score: number;
    reasoning: string;
  };
  overall_feedback: string;
  cv_recommendation: string;
}

export interface ProjectEvaluationOutput {
  correctness: {
    score: number;
    reasoning: string;
  };
  code_quality: {
    score: number;
    reasoning: string;
  };
  resilience: {
    score: number;
    reasoning: string;
  };
  documentation: {
    score: number;
    reasoning: string;
  };
  creativity: {
    score: number;
    reasoning: string;
  };
  overall_feedback: string;
  project_recommendation: string;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

