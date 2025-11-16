import { z } from 'zod';

/**
 * Zod schema for project evaluation structured output
 */
export const projectEvaluationSchema = z.object({
  correctness: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string().min(50),
  }),
  code_quality: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string().min(50),
  }),
  resilience: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string().min(50),
  }),
  documentation: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string().min(50),
  }),
  creativity: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string().min(50),
  }),
  overall_feedback: z.string().min(50),
  project_recommendation: z.string().min(100),
});

