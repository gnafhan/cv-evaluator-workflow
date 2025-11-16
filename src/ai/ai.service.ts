import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { GenerateOptions, CVEvaluationOutput, ProjectEvaluationOutput } from './types/evaluation.types';
import { ResponseValidator, ValidationError } from './validators/response.validator';
import { cvEvaluationSchema } from './schemas/cv-evaluation.schema';
import { projectEvaluationSchema } from './schemas/project-evaluation.schema';
import { cvStructureSchema } from './schemas/cv-structure.schema';
import { projectStructureSchema } from './schemas/project-structure.schema';
import { StructuredOutputHelper } from './helpers/structured-output.helper';

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
    return this.callWithRetry(
      async () => {
        const result = await StructuredOutputHelper.generateWithFallback({
          model: google(this.primaryModel),
          systemPrompt,
          userPrompt,
          schema: cvEvaluationSchema,
          primaryModel: google(this.primaryModel),
          fastModel: google(this.fastModel),
          logger: this.logger,
          maxOutputTokens: 5000,
        });

        return this.validator.validateCVEvaluation(result);
      },
      3, // maxRetries
    );
  }

  async generateProjectEvaluation(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<ProjectEvaluationOutput> {
    return this.callWithRetry(
      async () => {
        const result = await StructuredOutputHelper.generateWithFallback({
          model: google(this.primaryModel),
          systemPrompt,
          userPrompt,
          schema: projectEvaluationSchema,
          primaryModel: google(this.primaryModel),
          fastModel: google(this.fastModel),
          logger: this.logger,
          maxOutputTokens: 5000,
        });

        return this.validator.validateProjectEvaluation(result);
      },
      3, // maxRetries
    );
  }

  async generateCVStructure(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{
    name?: string;
    experience: Array<{
      title: string;
      company: string;
      duration?: string;
      description?: string;
    }>;
    skills: string[];
    education: Array<{
      degree: string;
      institution: string;
      year: string | null;
    }>;
    achievements: string[];
  }> {
    return this.callWithRetry(
      async () => {
        return StructuredOutputHelper.generateWithRetry({
          model: google(this.fastModel),
          systemPrompt,
          userPrompt,
          schema: cvStructureSchema,
          logger: this.logger,
          maxOutputTokens: 4000,
          retryTemperature: 0.3,
        });
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
    return this.callWithRetry(
      async () => {
        return StructuredOutputHelper.generateWithRetry({
          model: google(this.fastModel),
          systemPrompt,
          userPrompt,
          schema: projectStructureSchema,
          logger: this.logger,
          maxOutputTokens: 3000,
          retryTemperature: 0.3,
        });
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

