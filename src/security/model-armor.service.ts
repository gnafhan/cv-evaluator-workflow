import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as modelarmor from '@google-cloud/modelarmor';

const { ModelArmorClient } = modelarmor.v1;
type ModelArmorClientType = typeof ModelArmorClient.prototype.constructor extends new (...args: any[]) => infer T ? T : never;
const { protos } = modelarmor;
const ByteItemType = protos.google.cloud.modelarmor.v1.ByteDataItem.ByteItemType;

export interface ScreeningResult {
  blocked: boolean;
  reasons: string[];
  categories: string[];
}

@Injectable()
export class ModelArmorService implements OnModuleInit {
  private readonly logger = new Logger(ModelArmorService.name);
  private readonly enabled: boolean;
  private readonly projectId: string;
  private readonly location: string;
  private readonly apiKey: string;
  private templateId: string | null = null;
  private client: InstanceType<typeof ModelArmorClient> | null = null;

  constructor(private configService: ConfigService) {
    const config = this.configService.get<{
      modelArmor: {
        enabled: boolean;
        projectId: string;
        location: string;
        apiKey?: string;
        templateId?: string;
      };
    }>('app');

    this.enabled = config?.modelArmor.enabled || false;
    this.projectId = config?.modelArmor.projectId || '';
    this.location = config?.modelArmor.location || 'asia-southeast1';
    this.apiKey = config?.modelArmor.apiKey || '';
    this.templateId = config?.modelArmor.templateId || null;

    this.logger.log(`Model Armor service initialized - enabled: ${this.enabled}, hasApiKey: ${!!this.apiKey}, hasProjectId: ${!!this.projectId}, templateId: ${this.templateId}`);

    if (this.enabled) {
      if (!this.apiKey) {
        this.logger.warn('⚠ Model Armor enabled but API key not configured');
      }
      if (!this.projectId) {
        this.logger.warn('⚠ Model Armor enabled but GCP_PROJECT_ID not configured');
      }
      if (!this.templateId) {
        this.logger.warn('⚠ Model Armor enabled but template ID not configured - will try to create default template');
      }

      // Initialize Model Armor client
      if (this.projectId) {
        try {
          this.client = new ModelArmorClient({
            apiEndpoint: `modelarmor.${this.location}.rep.googleapis.com`,
            // Credentials will be loaded from GOOGLE_APPLICATION_CREDENTIALS environment variable
            // or Application Default Credentials
          });
          this.logger.log(`Model Armor client initialized with endpoint: modelarmor.${this.location}.rep.googleapis.com`);
        } catch (error: any) {
          this.logger.error(`Failed to initialize Model Armor client: ${error.message}`);
        }
      }
    }
  }

  async onModuleInit() {
    this.logger.log(`Model Armor initialization - enabled: ${this.enabled}, templateId: ${this.templateId}, projectId: ${this.projectId}, location: ${this.location}`);
    
    if (!this.enabled) {
      this.logger.debug('Model Armor is disabled in configuration');
      return;
    }

    if (!this.apiKey) {
      this.logger.error('Model Armor cannot initialize: API key is missing');
      this.templateId = null;
      return;
    }

    if (!this.projectId) {
      this.logger.error('Model Armor cannot initialize: GCP_PROJECT_ID is missing');
      this.templateId = null;
      return;
    }

    // If template ID is provided in config, verify it exists
    if (this.templateId) {
      try {
        await this.verifyTemplate(this.templateId);
        this.logger.log(`✓ Model Armor template verified and ready: ${this.templateId}`);
      } catch (error: any) {
        if (error.message?.includes('PERMISSION_DENIED') || error.message?.includes('permission')) {
          this.logger.warn(`⚠ Template ${this.templateId} verification skipped due to permission issue`);
          this.logger.warn('⚠ Ensure service account has "modelarmor.templates.get" permission');
          this.logger.warn('⚠ Will attempt to use template for sanitization (may work if sanitize permission exists)');
          // Continue with template ID - sanitize operations might work even if get doesn't
        } else {
          this.logger.error(`✗ Template ${this.templateId} verification failed: ${error.message}`);
          this.logger.warn('⚠ Model Armor will be disabled - template verification failed');
          // Keep templateId but mark as invalid - will retry on first use
        }
      }
    } else {
      // No template ID provided, try to create or get existing template
      try {
        this.templateId = await this.ensureTemplate();
        this.logger.log(`✓ Model Armor template ready: ${this.templateId}`);
      } catch (error: any) {
        this.logger.error(`✗ Failed to initialize Model Armor template: ${error.message}`);
        this.logger.warn('⚠ Model Armor will be disabled until template is configured');
        this.templateId = null;
      }
    }
  }

  /**
   * Verify that a template exists and is accessible
   */
  private async verifyTemplate(templateId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Model Armor client not initialized');
    }

    const templateName = `projects/${this.projectId}/locations/${this.location}/templates/${templateId}`;
    
    this.logger.debug(`Verifying template: ${templateName}`);
    
    try {
      // Use client to get template
      const [template] = await this.client.getTemplate({
        name: templateName,
      });
      
      this.logger.debug(`Template verified: ${template.name || 'unknown'}`);
    } catch (error: any) {
      this.logger.error(`Template verification failed: ${error.message}`);
      throw new Error(`Template verification failed: ${error.message}`);
    }
  }

  /**
   * Create or get existing Model Armor template
   * Based on: https://cloud.google.com/security-command-center/docs/manage-model-armor-templates
   */
  private async ensureTemplate(): Promise<string> {
    if (!this.client) {
      throw new Error('Model Armor client not initialized');
    }

    // Use the template ID from config if provided, otherwise use default
    const templateName = this.templateId || 'cv-evaluator-default-template';
    const templatePath = `projects/${this.projectId}/locations/${this.location}/templates/${templateName}`;

    // Try to get existing template first
    try {
      const [template] = await this.client.getTemplate({
        name: templatePath,
      });
      
      this.logger.log('Using existing Model Armor template');
      return template.name?.split('/').pop() || templateName;
    } catch (error: any) {
      this.logger.debug(`Template not found, will create new one: ${error.message}`);
    }

    // Create new template if it doesn't exist
    try {
      const result = await this.client.createTemplate({
        parent: `projects/${this.projectId}/locations/${this.location}`,
        templateId: templateName,
        template: {
          filters: [
            {
              promptInjectionJailbreak: {
                enabled: true,
                confidenceLevel: 'HIGH', // Increased sensitivity to detect prompt injections
              },
            },
            {
              responsibleAi: {
                enabled: true,
                confidenceLevel: 'MEDIUM',
                categories: [
                  'HATE_SPEECH',
                  'SEXUALLY_EXPLICIT',
                  'DANGEROUS_CONTENT',
                ],
              },
            },
            {
              sensitiveDataProtection: {
                enabled: true,
                confidenceLevel: 'MEDIUM',
                infoTypes: [
                  'CREDIT_CARD_NUMBER',
                  'US_SOCIAL_SECURITY_NUMBER',
                  'GOOGLE_CLOUD_CREDENTIALS',
                ],
              },
            },
            {
              maliciousUrl: {
                enabled: true,
                confidenceLevel: 'MEDIUM',
              },
            },
          ],
        } as any, // Type assertion needed as ITemplate interface may not include all fields
      });

      const template = Array.isArray(result) ? result[0] : result;
      this.logger.log('Created new Model Armor template');
      return (template as any).name?.split('/').pop() || templateName;
    } catch (error: any) {
      throw new Error(`Failed to create Model Armor template: ${error.message}`);
    }
  }

  /**
   * Screen a PDF file for malicious content before processing
   * Based on: https://cloud.google.com/security-command-center/docs/sanitize-prompts-responses
   */
  async screenPDF(filePath: string): Promise<ScreeningResult> {
    if (!this.enabled || !this.templateId || !this.client) {
      this.logger.debug('Model Armor is disabled, template not configured, or client not initialized - skipping PDF screening');
      return { blocked: false, reasons: [], categories: [] };
    }

    try {
      // Read PDF file and convert to base64
      const pdfContent = await fs.readFile(filePath);
      const pdfContentBase64 = pdfContent.toString('base64');

      // Use Model Armor client to sanitize PDF file
      // Based on: https://cloud.google.com/security-command-center/docs/sanitize-prompts-responses
      const request = {
        name: `projects/${this.projectId}/locations/${this.location}/templates/${this.templateId}`,
        userPromptData: {
          byteItem: {
            byteDataType: ByteItemType.PDF,
            byteData: pdfContentBase64,
          },
        },
      };

      const [response] = await this.client.sanitizeUserPrompt(request);

      // Parse Model Armor response
      // Response structure: response has violationDetails or similar
      const violations: any[] = (response as any).violations || 
                                (response as any).violationDetails || 
                                (response as any).violationDetailsList || 
                                [];
      const blocked = violations.length > 0;
      const reasons = violations.map((v: any) => v.reason || v.category || v.type || 'Unknown violation');
      const categories = violations.map((v: any) => v.category || v.type || 'UNKNOWN');

      if (blocked) {
        this.logger.warn('PDF blocked by Model Armor', {
          reasons,
          categories,
          violationCount: violations.length,
        });
      }

      return { blocked, reasons, categories };
    } catch (error: any) {
      this.logger.error(`Model Armor PDF screening failed: ${error.message}`, error.stack);
      // Don't block if screening fails, but log the error
      return { blocked: false, reasons: [], categories: [] };
    }
  }

  /**
   * Screen a text prompt before sending to LLM
   * Based on: https://cloud.google.com/security-command-center/docs/sanitize-prompts-responses
   */
  async screenPrompt(prompt: string): Promise<ScreeningResult> {
    if (!this.enabled || !this.templateId || !this.client) {
      this.logger.debug('Model Armor is disabled, template not configured, or client not initialized - skipping prompt screening');
      return { blocked: false, reasons: [], categories: [] };
    }

    // Skip screening if prompt is empty
    if (!prompt || prompt.trim().length === 0) {
      this.logger.debug('Prompt is empty, skipping Model Armor screening');
      return { blocked: false, reasons: [], categories: [] };
    }

    try {
      // Use Model Armor client to sanitize user prompt
      const request = {
        name: `projects/${this.projectId}/locations/${this.location}/templates/${this.templateId}`,
        userPromptData: {
          text: prompt,
        },
      };

      const [response] = await this.client.sanitizeUserPrompt(request);

      // Parse Model Armor response
      // Response structure: response has violationDetails or similar
      const violations: any[] = (response as any).violations || 
                                (response as any).violationDetails || 
                                (response as any).violationDetailsList || 
                                [];
      const blocked = violations.length > 0;
      const reasons = violations.map((v: any) => v.reason || v.category || v.type || 'Unknown violation');
      const categories = violations.map((v: any) => v.category || v.type || 'UNKNOWN');

      if (blocked) {
        this.logger.warn('Prompt blocked by Model Armor', {
          reasons,
          categories,
          promptPreview: prompt.substring(0, 100),
        });
      }

      return { blocked, reasons, categories };
    } catch (error: any) {
      this.logger.error(`Model Armor prompt screening failed: ${error.message}`, error.stack);
      return { blocked: false, reasons: [], categories: [] };
    }
  }

  /**
   * Screen LLM response for malicious content
   * Based on: https://cloud.google.com/security-command-center/docs/sanitize-prompts-responses
   */
  async screenResponse(response: string): Promise<ScreeningResult> {
    if (!this.enabled || !this.templateId || !this.client) {
      return { blocked: false, reasons: [], categories: [] };
    }

    // Skip screening if response is empty
    if (!response || response.trim().length === 0) {
      this.logger.debug('Response is empty, skipping Model Armor screening');
      return { blocked: false, reasons: [], categories: [] };
    }

    try {
      // Use Model Armor client to sanitize model response
      const request = {
        name: `projects/${this.projectId}/locations/${this.location}/templates/${this.templateId}`,
        modelResponseData: {
          text: response,
        },
      };

      const [result] = await this.client.sanitizeModelResponse(request);

      // Parse Model Armor response
      const violations: any[] = (result as any).violations || 
                                (result as any).violationDetails || 
                                (result as any).violationDetailsList || 
                                [];
      const blocked = violations.length > 0;
      const reasons = violations.map((v: any) => v.reason || v.category || v.type || 'Unknown violation');
      const categories = violations.map((v: any) => v.category || v.type || 'UNKNOWN');

      if (blocked) {
        this.logger.warn('Response blocked by Model Armor', {
          reasons,
          categories,
        });
      }

      return {
        blocked,
        reasons,
        categories,
      };
    } catch (error: any) {
      this.logger.error(`Model Armor response screening failed: ${error.message}`, error.stack);
      return { blocked: false, reasons: [], categories: [] };
    }
  }
}

