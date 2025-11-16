import { z } from 'zod';

/**
 * Zod schema for project structure extraction
 */
export const projectStructureSchema = z.object({
  structure: z.string(),
  implementation: z.string(),
  documentation: z.string(),
});

