import {
  CVEvaluationOutput,
  ProjectEvaluationOutput,
} from '../types/evaluation.types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ResponseValidator {
  validateCVEvaluation(response: any): CVEvaluationOutput {
    if (!response || typeof response !== 'object') {
      throw new ValidationError('Invalid response structure');
    }

    const scores = [
      'technical_skills_match',
      'experience_level',
      'relevant_achievements',
      'cultural_fit',
    ];

    for (const key of scores) {
      if (!response[key] || typeof response[key] !== 'object') {
        throw new ValidationError(`Missing or invalid score for ${key}`);
      }

      if (
        typeof response[key].score !== 'number' ||
        response[key].score < 1 ||
        response[key].score > 5
      ) {
        throw new ValidationError(
          `Score out of range for ${key}: ${response[key].score}`,
        );
      }

      if (
        !response[key].reasoning ||
        typeof response[key].reasoning !== 'string' ||
        response[key].reasoning.length < 20
      ) {
        throw new ValidationError(`Insufficient reasoning for ${key}`);
      }
    }

    if (
      !response.overall_feedback ||
      typeof response.overall_feedback !== 'string' ||
      response.overall_feedback.length < 50
    ) {
      throw new ValidationError('Missing or insufficient overall feedback');
    }

    if (
      !response.cv_recommendation ||
      typeof response.cv_recommendation !== 'string' ||
      response.cv_recommendation.length < 100
    ) {
      throw new ValidationError('Missing or insufficient CV recommendation');
    }

    return response as CVEvaluationOutput;
  }

  validateProjectEvaluation(response: any): ProjectEvaluationOutput {
    if (!response || typeof response !== 'object') {
      throw new ValidationError('Invalid response structure');
    }

    const scores = [
      'correctness',
      'code_quality',
      'resilience',
      'documentation',
      'creativity',
    ];

    for (const key of scores) {
      if (!response[key] || typeof response[key] !== 'object') {
        throw new ValidationError(`Missing or invalid score for ${key}`);
      }

      if (
        typeof response[key].score !== 'number' ||
        response[key].score < 1 ||
        response[key].score > 5
      ) {
        throw new ValidationError(
          `Score out of range for ${key}: ${response[key].score}`,
        );
      }

      if (
        !response[key].reasoning ||
        typeof response[key].reasoning !== 'string' ||
        response[key].reasoning.length < 20
      ) {
        throw new ValidationError(`Insufficient reasoning for ${key}`);
      }
    }

    if (
      !response.overall_feedback ||
      typeof response.overall_feedback !== 'string' ||
      response.overall_feedback.length < 50
    ) {
      throw new ValidationError('Missing or insufficient overall feedback');
    }

    if (
      !response.project_recommendation ||
      typeof response.project_recommendation !== 'string' ||
      response.project_recommendation.length < 100
    ) {
      throw new ValidationError('Missing or insufficient project recommendation');
    }

    return response as ProjectEvaluationOutput;
  }
}

