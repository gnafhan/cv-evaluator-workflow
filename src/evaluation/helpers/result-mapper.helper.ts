import { CVResult, ProjectResult } from '../evaluation.service';

/**
 * Helper to map evaluation results to database format
 */
export class ResultMapperHelper {
  /**
   * Map CV and Project results to evaluation result format
   */
  static mapToEvaluationResult(
    cvResult: CVResult,
    projectResult: ProjectResult,
    overallSummary: string,
  ) {
    return {
      cv_match_rate: cvResult.cv_match_rate,
      cv_feedback: cvResult.cv_feedback,
      cv_recommendation: cvResult.cv_recommendation,
      cv_scoring_breakdown: cvResult.cv_scoring_breakdown,
      project_score: projectResult.project_score,
      project_feedback: projectResult.project_feedback,
      project_recommendation: projectResult.project_recommendation,
      project_scoring_breakdown: projectResult.project_scoring_breakdown,
      overall_summary: overallSummary,
    };
  }
}

