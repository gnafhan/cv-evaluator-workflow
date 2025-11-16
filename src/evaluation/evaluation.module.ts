import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { EvaluationProcessor } from './processors/evaluation.processor';
import {
  EvaluationJob,
  EvaluationJobSchema,
} from '../database/schemas/evaluation-job.schema';
import { DocumentsModule } from '../documents/documents.module';
import { RagModule } from '../rag/rag.module';
import { AIModule } from '../ai/ai.module';
import { SecurityModule } from '../security/security.module';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EvaluationJob.name, schema: EvaluationJobSchema },
    ]),
    BullModule.registerQueue({
      name: 'evaluation-jobs',
    }),
    DocumentsModule,
    RagModule,
    AIModule,
    SecurityModule,
  ],
  controllers: [EvaluationController],
  providers: [
    EvaluationService,
    EvaluationProcessor,
    {
      provide: 'EVALUATION_QUEUE_CONFIG',
      useFactory: (configService: ConfigService) => {
        const config = configService.get<{
          queue: { concurrency: number; jobTimeout: number };
        }>('app');
        return {
          concurrency: config?.queue.concurrency || 5,
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential' as const,
              delay: 2000,
            },
            removeOnComplete: {
              age: 86400, // 24 hours
              count: 1000,
            },
            removeOnFail: {
              age: 604800, // 7 days
            },
          },
        };
      },
      inject: [ConfigService],
    },
  ],
  exports: [EvaluationService],
})
export class EvaluationModule {}

