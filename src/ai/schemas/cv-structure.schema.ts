import { z } from 'zod';

/**
 * Zod schema for CV structure extraction
 */
export const cvStructureSchema = z.object({
  name: z.string().optional(),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      duration: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
  skills: z.array(z.string()),
  education: z.array(
    z.object({
      degree: z.string(),
      institution: z.string(),
      year: z.string().nullable(),
    }),
  ),
  achievements: z.array(z.string()),
});

