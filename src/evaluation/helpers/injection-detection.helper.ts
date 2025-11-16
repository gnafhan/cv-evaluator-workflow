import { BadRequestException } from '@nestjs/common';
import { InjectionDetectionResult } from '../../security/prompt-injection-detector.service';

/**
 * Helper functions for handling prompt injection detection results
 */
export class InjectionDetectionHelper {
  /**
   * Check if CV should be blocked based on injection detection
   */
  static shouldBlockCV(detection: InjectionDetectionResult): boolean {
    return (
      detection.severity === 'critical' ||
      detection.severity === 'high' ||
      detection.confidence >= 0.3
    );
  }

  /**
   * Check if Project should be blocked based on injection detection
   */
  static shouldBlockProject(detection: InjectionDetectionResult): boolean {
    return detection.severity === 'critical' || detection.confidence >= 0.6;
  }

  /**
   * Create error message for blocked content
   */
  static createBlockedErrorMessage(
    contentType: 'CV' | 'Project Report',
    detection: InjectionDetectionResult,
  ): string {
    return `${contentType} contains prohibited manipulation attempts (${detection.severity} severity, confidence: ${detection.confidence.toFixed(2)}): ${detection.reason.substring(0, 100)}`;
  }

  /**
   * Handle injection detection result for CV
   * Throws BadRequestException if should be blocked, otherwise logs warning
   */
  static handleCVDetection(detection: InjectionDetectionResult): void {
    if (!detection.detected) {
      return;
    }

    if (this.shouldBlockCV(detection)) {
      throw new BadRequestException(
        this.createBlockedErrorMessage('CV', detection),
      );
    }

    // Log warning for detected but below threshold
    if (detection.confidence < 0.3) {
      // Warning will be logged by caller
    }
  }

  /**
   * Handle injection detection result for Project
   * Throws BadRequestException if should be blocked, otherwise logs warning
   */
  static handleProjectDetection(detection: InjectionDetectionResult): void {
    if (!detection.detected) {
      return;
    }

    if (this.shouldBlockProject(detection)) {
      throw new BadRequestException(
        this.createBlockedErrorMessage('Project Report', detection),
      );
    }

    // Log warning for detected but below threshold
    if (detection.severity === 'high' && detection.confidence < 0.6) {
      // Warning will be logged by caller
    }
  }
}

