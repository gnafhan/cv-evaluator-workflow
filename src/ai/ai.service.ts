import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { GenerateOptions, CVEvaluationOutput, ProjectEvaluationOutput } from './types/evaluation.types';
import { ResponseValidator, ValidationError } from './validators/response.validator';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly validator: ResponseValidator;
  private readonly apiKey: string;
  private readonly primaryModel: string;
  private readonly fastModel: string;

  constructor(private configService: ConfigService) {
    this.validator = new ResponseValidator();
    const config = this.configService.get<{
      googleAI: { apiKey: string; primaryModel: string; fastModel: string };
    }>('app');

    this.apiKey = config?.googleAI.apiKey || '';
    this.primaryModel = config?.googleAI.primaryModel || 'gemini-1.5-pro-latest';
    this.fastModel = config?.googleAI.fastModel || 'gemini-1.5-flash-latest';

    if (!this.apiKey) {
      this.logger.warn('Google AI API key not configured');
    }
  }

  async generateText(
    systemPrompt: string,
    userPrompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    const modelName = options.model || this.primaryModel;
    const temperature = options.temperature ?? 0.3;
    const maxTokens = options.maxTokens ?? 2000;

    return this.callWithRetry(async () => {
      const result = await generateText({
        model: google(modelName),
        system: systemPrompt,
        prompt: userPrompt,
        temperature,
        maxOutputTokens: maxTokens,
      });

      return result.text;
    });
  }

  async parseGeminiJSON(response: string): Promise<any> {
    if (!response || typeof response !== 'string') {
      this.logger.error('Invalid response type for JSON parsing', {
        type: typeof response,
        response: response?.substring(0, 200),
      });
      throw new Error('Response is not a valid string');
    }

    // Log the raw response for debugging
    this.logger.debug('Parsing JSON from response', {
      responseLength: response.length,
      responsePreview: response.substring(0, 500),
    });

    // Try to extract JSON from various formats
    let cleaned = response.trim();

    // Remove markdown code blocks
    cleaned = cleaned
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Try to find JSON object boundaries
    let jsonStart = cleaned.indexOf('{');
    let jsonEnd = cleaned.lastIndexOf('}') + 1;

    // If no object found, try array
    if (jsonStart === -1) {
      jsonStart = cleaned.indexOf('[');
      jsonEnd = cleaned.lastIndexOf(']') + 1;
    }

    if (jsonStart === -1 || jsonEnd === 0) {
      this.logger.error('No JSON structure found in response', {
        response: response.substring(0, 1000),
      });
      throw new Error('No JSON found in response');
    }

    cleaned = cleaned.substring(jsonStart, jsonEnd);

    // Try to parse the JSON
    try {
      const parsed = JSON.parse(cleaned);
      this.logger.debug('Successfully parsed JSON');
      return parsed;
    } catch (parseError: any) {
      // Try to fix common JSON issues
      let fixed = cleaned;

      // Remove trailing commas
      fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

      // Try parsing again
      try {
        const parsed = JSON.parse(fixed);
        this.logger.debug('Successfully parsed JSON after fixing trailing commas');
        return parsed;
      } catch (secondError: any) {
        this.logger.error('Failed to parse JSON after fixes', {
          originalError: parseError.message,
          fixedError: secondError.message,
          cleanedJson: cleaned.substring(0, 500),
          fullResponse: response.substring(0, 1000),
        });
        throw new Error(
          `Invalid JSON in response: ${parseError.message}. Response preview: ${response.substring(0, 200)}`,
        );
      }
    }
  }

  async generateCVEvaluation(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<CVEvaluationOutput> {
    // Define Zod schema for structured output
    const cvEvaluationSchema = z.object({
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

    return this.callWithRetry(
      async () => {
        const modelName = this.primaryModel;
        
        try {
          const result = await generateObject({
            model: google(modelName),
            system: systemPrompt,
            prompt: userPrompt,
            schema: cvEvaluationSchema,
            temperature: 0.3,
            maxOutputTokens: 5000, // Increased for recommendation field
          });

          if (!result.object) {
            throw new Error('Model returned empty response');
          }

          // The result.object is already validated and typed
          return this.validator.validateCVEvaluation(result.object);
        } catch (error: any) {
          // If structured output fails, try with a simpler approach
          if (error.message?.includes('No object generated') || error.message?.includes('did not return')) {
            this.logger.warn('Structured output failed, trying with higher temperature and different model');
            
            // Fallback: Try with flash model and higher temperature
            const fallbackResult = await generateObject({
              model: google(this.fastModel),
              system: systemPrompt,
              prompt: userPrompt,
              schema: cvEvaluationSchema,
              temperature: 0.5, // Higher temperature for more creativity
              maxOutputTokens: 5000, // Increased for recommendation field
            });

            if (!fallbackResult.object) {
              throw new Error('Fallback model also returned empty response');
            }

            return this.validator.validateCVEvaluation(fallbackResult.object);
          }
          throw error;
        }
      },
      3, // maxRetries
    );
  }

  async generateProjectEvaluation(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<ProjectEvaluationOutput> {
    // Define Zod schema for structured output
    const projectEvaluationSchema = z.object({
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

    return this.callWithRetry(
      async () => {
        const modelName = this.primaryModel;
        
        try {
          const result = await generateObject({
            model: google(modelName),
            system: systemPrompt,
            prompt: userPrompt,
            schema: projectEvaluationSchema,
            temperature: 0.3,
            maxOutputTokens: 5000, // Increased for recommendation field
          });

          if (!result.object) {
            throw new Error('Model returned empty response');
          }

          // The result.object is already validated and typed
          return this.validator.validateProjectEvaluation(result.object);
        } catch (error: any) {
          // If structured output fails, try with a simpler approach
          if (error.message?.includes('No object generated') || error.message?.includes('did not return')) {
            this.logger.warn('Structured output failed, trying with higher temperature and different model');
            
            // Fallback: Try with flash model and higher temperature
            const fallbackResult = await generateObject({
              model: google(this.fastModel),
              system: systemPrompt,
              prompt: userPrompt,
              schema: projectEvaluationSchema,
              temperature: 0.5, // Higher temperature for more creativity
              maxOutputTokens: 5000, // Increased for recommendation field
            });

            if (!fallbackResult.object) {
              throw new Error('Fallback model also returned empty response');
            }

            return this.validator.validateProjectEvaluation(fallbackResult.object);
          }
          throw error;
        }
      },
      3, // maxRetries
    );
  }

  async generateCVStructure(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{
    name: string | null;
    experience: Array<{
      company: string;
      role: string;
      duration: string;
      responsibilities: string[];
    }>;
    skills: string[];
    education: Array<{
      degree: string;
      institution: string;
      year: string | null;
    }>;
    achievements: string[];
  }> {
    const cvStructureSchema = z.object({
      name: z.string().nullable(),
      experience: z.array(
        z.object({
          company: z.string(),
          role: z.string(),
          duration: z.string(),
          responsibilities: z.array(z.string()),
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

    return this.callWithRetry(
      async () => {
        const modelName = this.fastModel; // Use fast model for structuring
        
        try {
          const result = await generateObject({
            model: google(modelName),
            system: systemPrompt,
            prompt: userPrompt,
            schema: cvStructureSchema,
            temperature: 0.2, // Slightly higher than 0.0 for better results
            maxOutputTokens: 4000, // Increase token limit
          });

          if (!result.object) {
            throw new Error('Model returned empty response');
          }

          return result.object;
        } catch (error: any) {
          if (error.message?.includes('No object generated') || error.message?.includes('did not return')) {
            this.logger.warn('CV structuring failed, retrying with higher temperature');
            
            // Retry with higher temperature
            const retryResult = await generateObject({
              model: google(modelName),
              system: systemPrompt,
              prompt: userPrompt,
              schema: cvStructureSchema,
              temperature: 0.3,
              maxOutputTokens: 4000,
            });

            if (!retryResult.object) {
              throw new Error('Retry also returned empty response');
            }

            return retryResult.object;
          }
          throw error;
        }
      },
      3, // maxRetries
    );
  }

  async generateProjectStructure(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{
    structure: string;
    implementation: string;
    documentation: string;
  }> {
    const projectStructureSchema = z.object({
      structure: z.string(),
      implementation: z.string(),
      documentation: z.string(),
    });

    return this.callWithRetry(
      async () => {
        const modelName = this.fastModel; // Use fast model for structuring
        
        try {
          const result = await generateObject({
            model: google(modelName),
            system: systemPrompt,
            prompt: userPrompt,
            schema: projectStructureSchema,
            temperature: 0.2, // Slightly higher than 0.0 for better results
            maxOutputTokens: 3000, // Increase token limit
          });

          if (!result.object) {
            throw new Error('Model returned empty response');
          }

          return result.object;
        } catch (error: any) {
          if (error.message?.includes('No object generated') || error.message?.includes('did not return')) {
            this.logger.warn('Project structuring failed, retrying with higher temperature');
            
            // Retry with higher temperature
            const retryResult = await generateObject({
              model: google(modelName),
              system: systemPrompt,
              prompt: userPrompt,
              schema: projectStructureSchema,
              temperature: 0.3,
              maxOutputTokens: 3000,
            });

            if (!retryResult.object) {
              throw new Error('Retry also returned empty response');
            }

            return retryResult.object;
          }
          throw error;
        }
      },
      3, // maxRetries
    );
  }

  private async callWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        if (attempt === maxRetries || !this.isRetryableError(error)) {
          throw error;
        }

        const delay = this.calculateBackoff(attempt);
        this.logger.warn(
          `Retry attempt ${attempt}/${maxRetries} after ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  private calculateBackoff(attempt: number): number {
    const baseDelay = 1000;
    const maxDelay = 30000;
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    const jitter = Math.random() * 0.3 * delay;
    return delay + jitter;
  }

  private isRetryableError(error: any): boolean {
    if (!error) return false;

    const status = error.status || error.statusCode;
    const code = error.code;

    return (
      status === 429 || // Rate limit
      status === 500 || // Server error
      status === 503 || // Service unavailable
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ENOTFOUND' ||
      error.message?.includes('timeout') ||
      error.message?.includes('network')
    );
  }
}

