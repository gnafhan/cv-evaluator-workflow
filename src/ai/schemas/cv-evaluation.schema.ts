import { z } from 'zod';

/**
 * Zod schema for CV evaluation structured output
 */
export const cvEvaluationSchema = z.object({
  technical_skills_match: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string().min(50),
  }),
  experience_level: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string().min(50),
  }),
  relevant_achievements: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string().min(50),
  }),
  cultural_fit: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string().min(50),
  }),
  overall_feedback: z.string().min(50),
  cv_recommendation: z.string().min(100),
});

