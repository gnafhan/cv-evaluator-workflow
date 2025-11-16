import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SystemDocumentDocument = HydratedDocument<SystemDocument>;

export type SystemDocumentType =
  | 'job_description'
  | 'case_study_brief'
  | 'cv_scoring_rubric'
  | 'project_scoring_rubric';

@Schema({ timestamps: true })
export class SystemDocument {
  @Prop({
    required: true,
    enum: [
      'job_description',
      'case_study_brief',
      'cv_scoring_rubric',
      'project_scoring_rubric',
    ],
    index: true,
  })
  document_type: SystemDocumentType;

  @Prop()
  job_title?: string;

  @Prop({ required: true })
  document_id: string;

  @Prop({ required: true })
  version: string;

  @Prop({ default: true })
  is_active: boolean;

  @Prop()
  embedded_at?: Date;

  @Prop({ default: 0 })
  chunk_count: number;
}

export const SystemDocumentSchema =
  SchemaFactory.createForClass(SystemDocument);

