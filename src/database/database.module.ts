import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Document, DocumentSchema } from './schemas/document.schema';
import {
  EvaluationJob,
  EvaluationJobSchema,
} from './schemas/evaluation-job.schema';
import {
  SystemDocument,
  SystemDocumentSchema,
} from './schemas/system-document.schema';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const config = configService.get<{ database: { uri: string } }>('app');
        return {
          uri: config?.database.uri || 'mongodb://localhost:27017/cv-evaluator',
        };
      },
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: EvaluationJob.name, schema: EvaluationJobSchema },
      { name: SystemDocument.name, schema: SystemDocumentSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}

