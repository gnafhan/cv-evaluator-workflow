import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Mistral } from '@mistralai/mistralai';
import { Document, DocumentDocument, DocumentType } from '../database/schemas/document.schema';

export interface ParsedContent {
  text: string;
  metadata: {
    pages: number;
    [key: string]: any;
  };
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly uploadDir: string;
  private readonly mistralClient: Mistral | null;

  constructor(
    @InjectModel(Document.name)
    private documentModel: Model<DocumentDocument>,
    private configService: ConfigService,
  ) {
    const config = this.configService.get<{
      fileStorage: { uploadDir: string };
      mistral: { apiKey: string; ocrModel: string };
    }>('app');
    
    this.uploadDir = config?.fileStorage.uploadDir || './uploads';
    this.ensureUploadDirectory();

    // Initialize Mistral client if API key is provided
    if (config?.mistral?.apiKey) {
      this.mistralClient = new Mistral({ apiKey: config.mistral.apiKey });
    } else {
      this.mistralClient = null;
      this.logger.warn('Mistral API key not configured. OCR will not be available.');
    }
  }

  private async ensureUploadDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore error
    }
  }

  async uploadDocument(
    file: Express.Multer.File,
    type: 'cv' | 'project_report',
  ): Promise<string> {
    // Validate file
    await this.validatePDF(file.buffer);

    // Generate unique document ID
    const documentId = this.generateDocumentId(type);

    // Save file to disk
    const filename = `${documentId}.pdf`;
    const filePath = path.join(this.uploadDir, filename);

    await fs.writeFile(filePath, file.buffer);

    // Save document metadata to database (without parsed content)
    // OCR will be performed during evaluation
    const document = new this.documentModel({
      document_id: documentId,
      type: type as DocumentType,
      filename: file.originalname,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.mimetype,
      // parsed_content will be added during evaluation
      embedding_status: 'pending',
    });

    await document.save();

    return documentId;
  }

  async parsePDF(filePath: string): Promise<ParsedContent> {
    try {
      if (!this.mistralClient) {
        throw new BadRequestException(
          'OCR service is not available. Please configure MISTRAL_API_KEY.',
        );
      }

      const config = this.configService.get<{
        mistral: { ocrModel: string };
      }>('app');

      // Read PDF file and convert to base64
      const fileBuffer = await fs.readFile(filePath);
      const base64Pdf = fileBuffer.toString('base64');

      this.logger.log(`Processing PDF with Mistral OCR: ${filePath}`);

      // Call Mistral OCR API
      // Note: Mistral OCR requires a public URL, not a data URL for PDFs
      // For local files, we'll use base64 but need to check the API format
      // First, try with base64 using the document format
      let ocrResponse: any;
      
      try {
        // Try base64 format first (if supported)
        ocrResponse = await this.mistralClient.ocr.process({
          model: config?.mistral.ocrModel || 'mistral-ocr-latest',
          document: {
            type: 'document_base64',
            documentBase64: base64Pdf,
          } as any,
          includeImageBase64: false,
        });
      } catch (base64Error: any) {
        // If base64 doesn't work, try data URL format
        this.logger.warn('Base64 format failed, trying data URL format', {
          error: base64Error.message,
          status: base64Error.status,
          response: base64Error.response?.data || base64Error.body,
        });
        
        const dataUrl = `data:application/pdf;base64,${base64Pdf}`;
        
        try {
          ocrResponse = await this.mistralClient.ocr.process({
            model: config?.mistral.ocrModel || 'mistral-ocr-latest',
            document: {
              type: 'document_url',
              documentUrl: dataUrl,
            },
            includeImageBase64: false,
          });
        } catch (dataUrlError: any) {
          this.logger.error('Both base64 and data URL formats failed', {
            base64Error: {
              message: base64Error.message,
              status: base64Error.status,
              response: base64Error.response?.data || base64Error.body,
            },
            dataUrlError: {
              message: dataUrlError.message,
              status: dataUrlError.status,
              response: dataUrlError.response?.data || dataUrlError.body,
            },
          });
          
          // Provide more specific error message
          const errorMessage = dataUrlError.message || base64Error.message || 'Unable to process PDF';
          throw new BadRequestException(
            `Mistral OCR failed: ${errorMessage}. Please ensure your PDF is valid and accessible.`,
          );
        }
      }

      // Log the full response structure for debugging
      this.logger.log('OCR Response received', {
        keys: ocrResponse ? Object.keys(ocrResponse) : [],
        responseType: typeof ocrResponse,
        fullResponse: JSON.stringify(ocrResponse, null, 2).substring(0, 1000), // Log first 1000 chars
      });

      // Extract text from OCR response
      // Mistral OCR returns markdown format text
      // According to Mistral docs, the response contains text and pages
      let extractedText = '';
      
      // Try different possible property names based on Mistral OCR response structure
      if (typeof ocrResponse === 'string') {
        extractedText = ocrResponse;
      } else if (ocrResponse && typeof ocrResponse === 'object') {
        // Check common Mistral OCR response properties
        extractedText = 
          (ocrResponse as any).text ||
          (ocrResponse as any).content ||
          (ocrResponse as any).markdown ||
          (ocrResponse as any).data?.text ||
          (ocrResponse as any).result?.text ||
          // If response has pages array, extract text from each page
          ((ocrResponse as any).pages && Array.isArray((ocrResponse as any).pages)
            ? (ocrResponse as any).pages
                .map((p: any) => p.text || p.content || p.markdown || '')
                .filter((t: string) => t)
                .join('\n\n')
            : '') ||
          // Check if it's nested in a response property
          ((ocrResponse as any).response?.text) ||
          ((ocrResponse as any).output?.text) ||
          '';
      }

      // Convert to string and clean up
      extractedText = String(extractedText || '').trim();

      this.logger.log(
        `Extracted text length: ${extractedText.length} characters from OCR response`,
      );

      // Check if we got any text at all
      if (!extractedText || extractedText.length < 10) {
        // Log the actual response for debugging
        this.logger.error('OCR returned insufficient text', {
          textLength: extractedText.length,
          responseKeys: ocrResponse ? Object.keys(ocrResponse) : [],
          responseSample: JSON.stringify(ocrResponse).substring(0, 500),
        });
        
        // Provide helpful error message
        throw new BadRequestException(
          `PDF processing returned insufficient text (${extractedText.length} characters). ` +
          `The OCR response structure may be different than expected. ` +
          `Please check server logs for the actual response structure.`,
        );
      }

      // Extract page count if available
      const pageCount = (ocrResponse as any).pages?.length || 
                       (ocrResponse as any).pageCount || 
                       1;

      this.logger.log(
        `Successfully extracted ${extractedText.length} characters from PDF (${pageCount} pages)`,
      );

      return {
        text: extractedText,
        metadata: {
          pages: pageCount,
          ocr_provider: 'mistral',
          format: 'markdown',
        },
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Failed to parse PDF with Mistral OCR: ${error.message}`);

      // Provide more helpful error messages
      if (error.status === 401 || error.status === 403) {
        throw new BadRequestException(
          'Invalid Mistral API key. Please check your MISTRAL_API_KEY configuration.',
        );
      }

      if (error.status === 429) {
        throw new BadRequestException(
          'Mistral API rate limit exceeded. Please try again later.',
        );
      }

      throw new BadRequestException(
        `Failed to parse PDF: ${error.message || 'Unknown error occurred'}`,
      );
    }
  }

  async validatePDF(buffer: Buffer): Promise<boolean> {
    // Check PDF magic number
    const pdfHeader = buffer.slice(0, 4).toString();
    if (pdfHeader !== '%PDF') {
      throw new BadRequestException('Invalid PDF file format');
    }

    // Check file size
    const config = this.configService.get<{ fileStorage: { maxFileSize: number } }>('app');
    const maxSize = config?.fileStorage.maxFileSize || 10485760; // 10MB

    if (buffer.length > maxSize) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`,
      );
    }

    return true;
  }

  async getDocumentById(documentId: string): Promise<DocumentDocument> {
    const document = await this.documentModel.findOne({ document_id: documentId });

    if (!document) {
      throw new NotFoundException(`Document with ID ${documentId} not found`);
    }

    return document;
  }

  async updateDocumentParsedContent(
    documentId: string,
    parsedContent: ParsedContent,
  ): Promise<void> {
    await this.documentModel.updateOne(
      { document_id: documentId },
      {
        $set: {
          parsed_content: parsedContent,
        },
      },
    );
  }

  private generateDocumentId(type: 'cv' | 'project_report'): string {
    const prefix = type === 'cv' ? 'doc_cv_' : 'doc_pr_';
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${prefix}${timestamp}${random}`;
  }
}

