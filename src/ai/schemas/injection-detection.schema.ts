import { z } from 'zod';

/**
 * Zod schema for prompt injection detection
 */
export const injectionDetectionSchema = z.object({
  detected: z.boolean(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(20), // Allow longer explanations
  suspicious_sections: z
    .array(
      z.object({
        text: z.string().max(1000), // Limit individual section text length
        start_index: z.number().optional(),
        end_index: z.number().optional(),
      }),
    )
    .optional(),
});

