import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DocumentsService } from '../documents/documents.service';
import { RagService } from '../rag/rag.service';
import { AIService } from '../ai/ai.service';
import { ModelArmorService } from '../security/model-armor.service';
import { PromptInjectionDetectorService } from '../security/prompt-injection-detector.service';
import { InjectionDetectionHelper } from './helpers/injection-detection.helper';
import {
  CV_EVALUATION_SYSTEM_PROMPT,
  CV_EVALUATION_USER_PROMPT,
} from '../ai/prompts/cv-evaluation.prompt';
import {
  PROJECT_EVALUATION_SYSTEM_PROMPT,
  PROJECT_EVALUATION_USER_PROMPT,
} from '../ai/prompts/project-evaluation.prompt';
import {
  SYNTHESIS_SYSTEM_PROMPT,
  SYNTHESIS_USER_PROMPT,
} from '../ai/prompts/synthesis.prompt';
import {
  EvaluationJob,
  EvaluationJobDocument,
} from '../database/schemas/evaluation-job.schema';
import { Document } from '../database/schemas/document.schema';

export interface ParsedCV {
  name?: string;
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
    year?: string;
  }>;
  achievements: string[];
  rawText: string;
}

export interface ParsedProject {
  structure: string;
  implementation: string;
  documentation: string;
  rawText: string;
}

export interface CVResult {
  cv_match_rate: number;
  cv_feedback: string;
  cv_recommendation: string;
  cv_scoring_breakdown: {
    technical_skills_match: { score: number; weight: number; weighted_score: number };
    experience_level: { score: number; weight: number; weighted_score: number };
    relevant_achievements: { score: number; weight: number; weighted_score: number };
    cultural_fit: { score: number; weight: number; weighted_score: number };
  };
}

export interface ProjectResult {
  project_score: number;
  project_feedback: string;
  project_recommendation: string;
  project_scoring_breakdown: {
    correctness: { score: number; weight: number; weighted_score: number };
    code_quality: { score: number; weight: number; weighted_score: number };
    resilience: { score: number; weight: number; weighted_score: number };
    documentation: { score: number; weight: number; weighted_score: number };
    creativity: { score: number; weight: number; weighted_score: number };
  };
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    @InjectModel(EvaluationJob.name)
    private evaluationJobModel: Model<EvaluationJobDocument>,
    private documentsService: DocumentsService,
    private ragService: RagService,
    private aiService: AIService,
    private modelArmorService: ModelArmorService,
    private injectionDetector: PromptInjectionDetectorService,
  ) {}

  async parseCV(cvId: string): Promise<ParsedCV> {
    const document = await this.documentsService.getDocumentById(cvId);
    
    // Ensure file is saved before screening
    if (!document.file_path) {
      throw new NotFoundException(`File path not found for document ${cvId}`);
    }

    // Screen PDF with Model Armor before processing
    this.logger.log(`Screening CV with Model Armor: ${cvId}`);
    const screeningResult = await this.modelArmorService.screenPDF(document.file_path);
    
    if (screeningResult.blocked) {
      throw new BadRequestException(
        `CV blocked by security screening: ${screeningResult.reasons.join(', ')}`,
      );
    }
    
    // Check if we already have parsed content
    let cvText = document.parsed_content?.text;
    
    // If not, perform OCR to extract text from PDF
    if (!cvText) {
      this.logger.log(`Performing OCR on CV: ${cvId}`);
      const parsedContent = await this.documentsService.parsePDF(document.file_path);
      cvText = parsedContent.text;
      
      // Update document with parsed content
      await this.documentsService.updateDocumentParsedContent(cvId, parsedContent);
    }

    // Pre-screen for prompt injection before processing using AI-based detection
    this.logger.log('Pre-screening CV text for prompt injection using AI');
    const injectionDetection = await this.injectionDetector.detectInjectionWithAI(cvText, 'cv');
    
    if (injectionDetection.detected) {
      // Log detection details
      this.logger.warn('Prompt injection detected in CV', {
        severity: injectionDetection.severity,
        confidence: injectionDetection.confidence,
        reason: injectionDetection.reason.substring(0, 100),
      });

      // Handle blocking logic using helper
      InjectionDetectionHelper.handleCVDetection(injectionDetection);

      // Log warning for detected but below threshold
      if (injectionDetection.confidence < 0.3) {
        this.logger.warn('Prompt injection detected in CV but below threshold, continuing', {
          severity: injectionDetection.severity,
          confidence: injectionDetection.confidence,
        });
      }
    }

    // Use AI to structure the CV text into a structured format
    // This helps the evaluation model understand the CV better
    const structuredCV = await this.structureCVWithAI(cvText);

    return {
      ...structuredCV,
      rawText: cvText, // Keep raw text for evaluation
    };
  }

  private async structureCVWithAI(cvText: string): Promise<Omit<ParsedCV, 'rawText'>> {
    // Use structured output to extract CV information
    const structurePrompt = `Extract and structure the following CV information.

CV TEXT:
${cvText.substring(0, 5000)} ${cvText.length > 5000 ? '...' : ''}

Extract the candidate's name, work experience, skills, education, and achievements.`;

    try {
      const structured = await this.aiService.generateCVStructure(
        'You are an expert at extracting structured information from CVs.',
        structurePrompt,
      );
      
      // Map structured CV to expected format
      return {
        name: structured.name || undefined,
        experience: (structured.experience || []).map((exp) => ({
          company: exp.company,
          role: exp.title, // Map title to role
          duration: exp.duration || '',
          responsibilities: exp.description ? [exp.description] : [],
        })),
        skills: structured.skills || [],
        education: (structured.education || []).map((edu) => ({
          degree: edu.degree,
          institution: edu.institution,
          year: edu.year ?? undefined, // Convert null to undefined
        })),
        achievements: structured.achievements || [],
      };
    } catch (error: any) {
      this.logger.error('Failed to structure CV with AI, using basic structure', {
        error: error.message,
      });
      // Fallback to basic structure
      return {
        name: undefined,
        experience: [],
        skills: [],
        education: [],
        achievements: [],
      };
    }
  }

  async evaluateCV(cvData: ParsedCV, jobTitle: string): Promise<CVResult> {
    // Retrieve relevant context from RAG
    const cvQuery = `Backend development experience with ${jobTitle} requirements`;
    const jobDescriptionChunks = await this.ragService.query(
      cvQuery,
      { document_type: 'job_description', job_title: jobTitle },
      5,
      'job_descriptions',
    );
    const rubricChunks = await this.ragService.query(
      'CV scoring rubric evaluation criteria',
      { document_type: 'cv_scoring_rubric' },
      3,
      'scoring_rubrics',
    );

    const jobDescription = jobDescriptionChunks
      .map((chunk) => chunk.content)
      .join('\n\n');
    const rubricContent = rubricChunks.map((chunk) => chunk.content).join('\n\n');
    const relevantChunks = [...jobDescriptionChunks, ...rubricChunks]
      .map((chunk) => chunk.content)
      .join('\n\n');

    // Generate evaluation
    const systemPrompt = CV_EVALUATION_SYSTEM_PROMPT(
      jobTitle,
      rubricContent,
      jobDescription,
    );
    const userPrompt = CV_EVALUATION_USER_PROMPT(cvData.rawText, relevantChunks);

    // Screen prompts with Model Armor before sending to LLM
    this.logger.log('Screening prompts with Model Armor');
    const systemPromptScreening = await this.modelArmorService.screenPrompt(systemPrompt);
    const userPromptScreening = await this.modelArmorService.screenPrompt(userPrompt);

    if (systemPromptScreening.blocked || userPromptScreening.blocked) {
      const reasons = [
        ...(systemPromptScreening.blocked ? systemPromptScreening.reasons : []),
        ...(userPromptScreening.blocked ? userPromptScreening.reasons : []),
      ];
      throw new BadRequestException(
        `Prompts blocked by security screening: ${reasons.join(', ')}`,
      );
    }

    const evaluation = await this.aiService.generateCVEvaluation(
      systemPrompt,
      userPrompt,
    );

    // Calculate weighted match rate
    const weights = {
      technical_skills_match: 0.4,
      experience_level: 0.25,
      relevant_achievements: 0.2,
      cultural_fit: 0.15,
    };

    const cv_match_rate =
      evaluation.technical_skills_match.score * weights.technical_skills_match +
      evaluation.experience_level.score * weights.experience_level +
      evaluation.relevant_achievements.score * weights.relevant_achievements +
      evaluation.cultural_fit.score * weights.cultural_fit;

    return {
      cv_match_rate: cv_match_rate / 5, // Normalize to 0-1
      cv_feedback: evaluation.overall_feedback,
      cv_recommendation: evaluation.cv_recommendation,
      cv_scoring_breakdown: {
        technical_skills_match: {
          score: evaluation.technical_skills_match.score,
          weight: weights.technical_skills_match,
          weighted_score:
            evaluation.technical_skills_match.score *
            weights.technical_skills_match,
        },
        experience_level: {
          score: evaluation.experience_level.score,
          weight: weights.experience_level,
          weighted_score:
            evaluation.experience_level.score * weights.experience_level,
        },
        relevant_achievements: {
          score: evaluation.relevant_achievements.score,
          weight: weights.relevant_achievements,
          weighted_score:
            evaluation.relevant_achievements.score *
            weights.relevant_achievements,
        },
        cultural_fit: {
          score: evaluation.cultural_fit.score,
          weight: weights.cultural_fit,
          weighted_score: evaluation.cultural_fit.score * weights.cultural_fit,
        },
      },
    };
  }

  async parseProject(projectId: string): Promise<ParsedProject> {
    const document = await this.documentsService.getDocumentById(projectId);
    
    // Ensure file is saved before screening
    if (!document.file_path) {
      throw new NotFoundException(`File path not found for document ${projectId}`);
    }

    // Screen PDF with Model Armor before processing
    this.logger.log(`Screening project report with Model Armor: ${projectId}`);
    const screeningResult = await this.modelArmorService.screenPDF(document.file_path);
    
    if (screeningResult.blocked) {
      throw new BadRequestException(
        `Project report blocked by security screening: ${screeningResult.reasons.join(', ')}`,
      );
    }
    
    // Check if we already have parsed content
    let projectText = document.parsed_content?.text;
    
    // If not, perform OCR to extract text from PDF
    if (!projectText) {
      this.logger.log(`Performing OCR on project report: ${projectId}`);
      const parsedContent = await this.documentsService.parsePDF(document.file_path);
      projectText = parsedContent.text;
      
      // Update document with parsed content
      await this.documentsService.updateDocumentParsedContent(projectId, parsedContent);
    }

    // Pre-screen for prompt injection before processing using AI-based detection
    this.logger.log('Pre-screening project report text for prompt injection using AI');
    const injectionDetection = await this.injectionDetector.detectInjectionWithAI(projectText, 'project');
    
    if (injectionDetection.detected) {
      // Log detection details
      this.logger.warn('Prompt injection detected in project report', {
        severity: injectionDetection.severity,
        confidence: injectionDetection.confidence,
        reason: injectionDetection.reason.substring(0, 100),
      });

      // Handle blocking logic using helper
      InjectionDetectionHelper.handleProjectDetection(injectionDetection);

      // Log warning for detected but below threshold
      if (injectionDetection.severity === 'high' && injectionDetection.confidence < 0.6) {
        this.logger.warn('Prompt injection detected in project report but below threshold, continuing', {
          severity: injectionDetection.severity,
          confidence: injectionDetection.confidence,
        });
      }
    }

    // Use AI to structure the project report
    const structuredProject = await this.structureProjectWithAI(projectText);

    return {
      ...structuredProject,
      rawText: projectText,
    };
  }

  private async structureProjectWithAI(projectText: string): Promise<Omit<ParsedProject, 'rawText'>> {
    // Use structured output to extract project information
    const structurePrompt = `Extract and structure the following project report information:

PROJECT REPORT TEXT:
${projectText.substring(0, 5000)} ${projectText.length > 5000 ? '...' : ''}

Extract information about the project structure, implementation details, and documentation quality.`;

    try {
      const structured = await this.aiService.generateProjectStructure(
        'You are an expert at analyzing project reports.',
        structurePrompt,
      );
      
      return {
        structure: structured.structure || 'Not specified',
        implementation: structured.implementation || 'Not specified',
        documentation: structured.documentation || 'Not specified',
      };
    } catch (error: any) {
      this.logger.warn('Failed to structure project with AI, using basic structure', {
        error: error.message,
      });
      return {
        structure: 'Not specified',
        implementation: 'Not specified',
        documentation: 'Not specified',
      };
    }
  }

  async evaluateProject(projectData: ParsedProject): Promise<ProjectResult> {
    // Retrieve relevant context from RAG
    const caseStudyChunks = await this.ragService.query(
      'case study requirements project implementation',
      { document_type: 'case_study_brief' },
      5,
      'case_studies',
    );
    const rubricChunks = await this.ragService.query(
      'project scoring rubric evaluation criteria',
      { document_type: 'project_scoring_rubric' },
      3,
      'scoring_rubrics',
    );

    const caseStudyRequirements = caseStudyChunks
      .map((chunk) => chunk.content)
      .join('\n\n');
    const projectRubric = rubricChunks.map((chunk) => chunk.content).join('\n\n');
    const relevantChunks = [...caseStudyChunks, ...rubricChunks]
      .map((chunk) => chunk.content)
      .join('\n\n');

    // Generate evaluation
    const systemPrompt = PROJECT_EVALUATION_SYSTEM_PROMPT(
      'Backend Developer',
      caseStudyRequirements,
      projectRubric,
    );
    const userPrompt = PROJECT_EVALUATION_USER_PROMPT(
      projectData.rawText,
      relevantChunks,
    );

    // Screen prompts with Model Armor before sending to LLM
    this.logger.log('Screening project evaluation prompts with Model Armor');
    const systemPromptScreening = await this.modelArmorService.screenPrompt(systemPrompt);
    const userPromptScreening = await this.modelArmorService.screenPrompt(userPrompt);

    if (systemPromptScreening.blocked || userPromptScreening.blocked) {
      const reasons = [
        ...(systemPromptScreening.blocked ? systemPromptScreening.reasons : []),
        ...(userPromptScreening.blocked ? userPromptScreening.reasons : []),
      ];
      throw new BadRequestException(
        `Prompts blocked by security screening: ${reasons.join(', ')}`,
      );
    }

    const evaluation = await this.aiService.generateProjectEvaluation(
      systemPrompt,
      userPrompt,
    );

    // Calculate weighted project score
    const weights = {
      correctness: 0.3,
      code_quality: 0.25,
      resilience: 0.2,
      documentation: 0.15,
      creativity: 0.1,
    };

    const project_score =
      evaluation.correctness.score * weights.correctness +
      evaluation.code_quality.score * weights.code_quality +
      evaluation.resilience.score * weights.resilience +
      evaluation.documentation.score * weights.documentation +
      evaluation.creativity.score * weights.creativity;

    return {
      project_score: project_score, // Normalize to 0-1, then scale to 0-5
      project_feedback: evaluation.overall_feedback,
      project_recommendation: evaluation.project_recommendation,
      project_scoring_breakdown: {
        correctness: {
          score: evaluation.correctness.score,
          weight: weights.correctness,
          weighted_score: evaluation.correctness.score * weights.correctness,
        },
        code_quality: {
          score: evaluation.code_quality.score,
          weight: weights.code_quality,
          weighted_score: evaluation.code_quality.score * weights.code_quality,
        },
        resilience: {
          score: evaluation.resilience.score,
          weight: weights.resilience,
          weighted_score: evaluation.resilience.score * weights.resilience,
        },
        documentation: {
          score: evaluation.documentation.score,
          weight: weights.documentation,
          weighted_score: evaluation.documentation.score * weights.documentation,
        },
        creativity: {
          score: evaluation.creativity.score,
          weight: weights.creativity,
          weighted_score: evaluation.creativity.score * weights.creativity,
        },
      },
    };
  }

  async synthesizeResults(
    cvResult: CVResult,
    projectResult: ProjectResult,
  ): Promise<string> {
    const systemPrompt = SYNTHESIS_SYSTEM_PROMPT;
    const userPrompt = SYNTHESIS_USER_PROMPT(
      cvResult.cv_match_rate,
      cvResult.cv_feedback,
      projectResult.project_score * 5, // Convert back to 0-5 scale
      projectResult.project_feedback,
    );

    // Screen prompts with Model Armor before sending to LLM
    this.logger.log('Screening synthesis prompts with Model Armor');
    const systemPromptScreening = await this.modelArmorService.screenPrompt(systemPrompt);
    const userPromptScreening = await this.modelArmorService.screenPrompt(userPrompt);

    if (systemPromptScreening.blocked || userPromptScreening.blocked) {
      const reasons = [
        ...(systemPromptScreening.blocked ? systemPromptScreening.reasons : []),
        ...(userPromptScreening.blocked ? userPromptScreening.reasons : []),
      ];
      throw new BadRequestException(
        `Synthesis prompts blocked by security screening: ${reasons.join(', ')}`,
      );
    }

    const summary = await this.aiService.generateText(
      systemPrompt,
      userPrompt,
      { temperature: 0.4, maxTokens: 2000 }, // Increased from 500 to 2000 for comprehensive summary
    );

    // Optionally screen the response (skip if empty)
    if (!summary || summary.trim().length === 0) {
      this.logger.warn('Synthesis response is empty, skipping Model Armor screening');
      return 'Summary generation completed. Please review the detailed evaluation results.';
    }

    const responseScreening = await this.modelArmorService.screenResponse(summary);
    if (responseScreening.blocked) {
      this.logger.warn('Synthesis response blocked by Model Armor', {
        reasons: responseScreening.reasons,
      });
      // Return a safe fallback message instead of the blocked response
      return 'Summary generation completed. Please review the detailed evaluation results.';
    }

    return summary;
  }

  async getJobById(jobId: string): Promise<EvaluationJobDocument> {
    const job = await this.evaluationJobModel.findOne({ job_id: jobId });

    if (!job) {
      throw new NotFoundException(`Evaluation job with ID ${jobId} not found`);
    }

    return job;
  }

  async createJob(
    jobTitle: string,
    cvId: string,
    projectReportId: string,
  ): Promise<string> {
    const jobId = this.generateJobId();
    const job = new this.evaluationJobModel({
      job_id: jobId,
      status: 'queued',
      progress_percentage: 0,
      input: {
        job_title: jobTitle,
        cv_id: cvId,
        project_report_id: projectReportId,
      },
      metadata: {
        llm_calls_count: 0,
        total_tokens_used: 0,
        processing_time_ms: 0,
        retry_count: 0,
      },
    });

    await job.save();
    return jobId;
  }

  async updateJobProgress(
    jobId: string,
    progress: number,
    stage?: string,
  ): Promise<void> {
    const job = await this.evaluationJobModel.findOne({ job_id: jobId });
    
    const update: any = {
      progress_percentage: progress,
      current_stage: stage,
      status: 'processing',
    };

    // Set started_at when transitioning from queued to processing
    if (job && job.status === 'queued' && !job.started_at) {
      update.started_at = new Date();
    }

    await this.evaluationJobModel.updateOne(
      { job_id: jobId },
      { $set: update },
    );
  }

  async completeJob(jobId: string, result: any): Promise<void> {
    await this.evaluationJobModel.updateOne(
      { job_id: jobId },
      {
        $set: {
          status: 'completed',
          progress_percentage: 100,
          result,
          completed_at: new Date(),
        },
      },
    );
  }

  async failJob(jobId: string, error: any, stage?: string): Promise<void> {
    await this.evaluationJobModel.updateOne(
      { job_id: jobId },
      {
        $set: {
          status: 'failed',
          error: {
            code: error.code || 'UNKNOWN_ERROR',
            message: error.message || 'Unknown error occurred',
            stage,
            timestamp: new Date(),
          },
        },
      },
    );
  }

  private generateJobId(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `eval_job_${timestamp}${random}`;
  }
}

