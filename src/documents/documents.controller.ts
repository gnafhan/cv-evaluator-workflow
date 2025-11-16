import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { UploadResponseDto } from './dto/upload-response.dto';

@Controller('upload')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'cv', maxCount: 1 },
      { name: 'project_report', maxCount: 1 },
    ]),
  )
  async upload(
    @UploadedFiles()
    files: {
      cv?: Express.Multer.File[];
      project_report?: Express.Multer.File[];
    },
  ): Promise<UploadResponseDto> {
    if (!files.cv || files.cv.length === 0) {
      throw new BadRequestException('CV file is required');
    }
    if (!files.project_report || files.project_report.length === 0) {
      throw new BadRequestException('Project report file is required');
    }

    const cvFile = files.cv[0];
    const projectReportFile = files.project_report[0];

    const cvId = await this.documentsService.uploadDocument(cvFile, 'cv');
    const projectReportId = await this.documentsService.uploadDocument(
      projectReportFile,
      'project_report',
    );

    return {
      cv_id: cvId,
      project_report_id: projectReportId,
      uploaded_at: new Date(),
    };
  }
}

