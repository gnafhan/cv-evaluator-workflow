import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import {
  INJECTION_DETECTION_SYSTEM_PROMPT,
  createInjectionDetectionUserPrompt,
} from './prompts/injection-detection.prompt';
import { injectionDetectionSchema } from '../ai/schemas/injection-detection.schema';

export interface InjectionDetectionResult {
  detected: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0.0 - 1.0
  reason: string;
  patterns: string[]; // Keep for backward compatibility
  suspiciousSections: Array<{
    start: number;
    end: number;
    text: string;
    reason: string;
  }>;
}

/**
 * AI-based service to detect prompt injection attacks in CVs and project reports
 * Uses Gemini Flash with few-shot learning for adaptive detection
 */
@Injectable()
export class PromptInjectionDetectorService {
  private readonly logger = new Logger(PromptInjectionDetectorService.name);

  // Confidence thresholds for different contexts
  private readonly CV_THRESHOLD = 0.3; // More sensitive for CVs
  private readonly PROJECT_THRESHOLD = 0.6; // More tolerant for Projects

  constructor(private readonly configService: ConfigService) {}

  /**
   * AI-based detection of prompt injection attacks
   * Uses Gemini Flash with few-shot learning for adaptive detection
   */
  async detectInjectionWithAI(
    text: string,
    context: 'cv' | 'project',
  ): Promise<InjectionDetectionResult> {
    // Empty text handling
    if (!text || text.trim().length === 0) {
      return {
        detected: false,
        severity: 'low',
        confidence: 0,
        reason: 'Empty text, no injection possible',
        patterns: [],
        suspiciousSections: [],
      };
    }

    // Truncate text if too long (max 8000 chars for AI processing)
    const truncatedText = text.length > 8000 ? text.substring(0, 8000) + '...' : text;

    try {
      // Create user prompt with context
      const userPrompt = createInjectionDetectionUserPrompt(truncatedText, context);

      // Get model name from config
      const config = this.configService.get<{
        googleAI: { fastModel: string };
      }>('app');
      const modelName = config?.googleAI?.fastModel || 'gemini-1.5-flash-latest';

      // Generate structured output
      const result = await generateObject({
        model: google(modelName),
        system: INJECTION_DETECTION_SYSTEM_PROMPT,
        prompt: userPrompt,
        schema: injectionDetectionSchema,
        temperature: 0.2, // Lower temperature for more consistent detection
        maxOutputTokens: 1000,
      });

      if (!result.object) {
        throw new Error('AI did not return detection result');
      }

      const detection = result.object;

      // Convert AI response to InjectionDetectionResult format
      const suspiciousSections: InjectionDetectionResult['suspiciousSections'] =
        (detection.suspicious_sections || []).map((section) => {
          const startIndex = section.start_index ?? 0;
          const endIndex = section.end_index ?? startIndex + section.text.length;

          return {
            start: startIndex,
            end: endIndex,
            text: section.text,
            reason: detection.reason,
          };
        });

      // Extract patterns from reason (for backward compatibility)
      const patterns = detection.detected ? [detection.reason] : [];

      if (detection.detected) {
        this.logger.warn('Prompt injection detected via AI', {
          context,
          severity: detection.severity,
          confidence: detection.confidence,
          reason: detection.reason.substring(0, 100),
        });
      }

      return {
        detected: detection.detected,
        severity: detection.severity,
        confidence: detection.confidence,
        reason: detection.reason,
        patterns,
        suspiciousSections,
      };
    } catch (error: any) {
      // If AI call fails, skip detection and continue processing
      this.logger.warn('AI-based prompt injection detection failed, skipping check', {
        error: error.message,
        context,
      });

      return {
        detected: false,
        severity: 'low',
        confidence: 0,
        reason: 'AI detection failed',
        patterns: [],
        suspiciousSections: [],
      };
    }
  }

  /**
   * Legacy method for backward compatibility - delegates to AI-based detection with default context
   * @deprecated Use detectInjectionWithAI instead
   */
  async detectInjection(text: string, context: 'cv' | 'project' = 'cv'): Promise<InjectionDetectionResult> {
    return this.detectInjectionWithAI(text, context);
  }

  /**
   * Sanitize text by removing suspicious injection sections using AI-based detection
   * Returns sanitized text and detection result
   */
  async sanitizeText(
    text: string,
    context: 'cv' | 'project' = 'cv',
  ): Promise<{
    sanitized: string;
    detection: InjectionDetectionResult;
    removedSections: Array<{ start: number; end: number; reason: string }>;
  }> {
    const detection = await this.detectInjectionWithAI(text, context);
    
    if (!detection.detected) {
      return {
        sanitized: text,
        detection,
        removedSections: [],
      };
    }

    let sanitized = text;
    const removedSections: Array<{ start: number; end: number; reason: string }> = [];
    
    // Remove suspicious sections in reverse order to maintain indices
    const sortedSections = [...detection.suspiciousSections].sort((a, b) => b.start - a.start);
    
    for (const section of sortedSections) {
      // Expand removal to include surrounding context that might be part of injection
      const removalStart = Math.max(0, section.start - 10);
      const removalEnd = Math.min(sanitized.length, section.end + 10);
      
      removedSections.push({
        start: removalStart,
        end: removalEnd,
        reason: section.reason,
      });

      sanitized = 
        sanitized.substring(0, removalStart) + 
        ' [Content removed due to security policy] ' +
        sanitized.substring(removalEnd);
    }

    if (removedSections.length > 0) {
      this.logger.warn('Sanitized text by removing suspicious sections', {
        originalLength: text.length,
        sanitizedLength: sanitized.length,
        removedSectionsCount: removedSections.length,
      });
    }

    return {
      sanitized,
      detection,
      removedSections,
    };
  }
}

