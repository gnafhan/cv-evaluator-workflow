import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { Logger } from '@nestjs/common';

/**
 * Helper for generating structured outputs with retry logic
 */
export class StructuredOutputHelper {
  /**
   * Generate structured output with fallback retry
   */
  static async generateWithFallback<T>(
    options: {
      model: LanguageModel;
      systemPrompt: string;
      userPrompt: string;
      schema: z.ZodSchema<T>;
      primaryModel: LanguageModel;
      fastModel: LanguageModel;
      logger: Logger;
      maxOutputTokens?: number;
    },
  ): Promise<T> {
    const {
      model,
      systemPrompt,
      userPrompt,
      schema,
      primaryModel,
      fastModel,
      logger,
      maxOutputTokens = 5000,
    } = options;

    try {
      const result = await generateObject({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        schema,
        temperature: 0.3,
        maxOutputTokens,
      });

      if (!result.object) {
        throw new Error('Model returned empty response');
      }

      return result.object;
    } catch (error: any) {
      // If structured output fails, try with fallback model
      if (
        error.message?.includes('No object generated') ||
        error.message?.includes('did not return')
      ) {
        logger.warn(
          'Structured output failed, trying with higher temperature and different model',
        );

        // Fallback: Try with flash model and higher temperature
        const fallbackResult = await generateObject({
          model: fastModel,
          system: systemPrompt,
          prompt: userPrompt,
          schema,
          temperature: 0.5, // Higher temperature for more creativity
          maxOutputTokens,
        });

        if (!fallbackResult.object) {
          throw new Error('Fallback model also returned empty response');
        }

        return fallbackResult.object;
      }
      throw error;
    }
  }

  /**
   * Generate structured output with simple retry (no fallback model)
   */
  static async generateWithRetry<T>(
    options: {
      model: LanguageModel;
      systemPrompt: string;
      userPrompt: string;
      schema: z.ZodSchema<T>;
      logger: Logger;
      maxOutputTokens?: number;
      retryTemperature?: number;
    },
  ): Promise<T> {
    const {
      model,
      systemPrompt,
      userPrompt,
      schema,
      logger,
      maxOutputTokens = 4000,
      retryTemperature = 0.3,
    } = options;

    try {
      const result = await generateObject({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        schema,
        temperature: 0.2,
        maxOutputTokens,
      });

      if (!result.object) {
        throw new Error('Model returned empty response');
      }

      return result.object;
    } catch (error: any) {
      if (
        error.message?.includes('No object generated') ||
        error.message?.includes('did not return')
      ) {
        logger.warn('Structured output failed, retrying with higher temperature');

        // Retry with higher temperature
        const retryResult = await generateObject({
          model,
          system: systemPrompt,
          prompt: userPrompt,
          schema,
          temperature: retryTemperature,
          maxOutputTokens,
        });

        if (!retryResult.object) {
          throw new Error('Retry also returned empty response');
        }

        return retryResult.object;
      }
      throw error;
    }
  }
}

