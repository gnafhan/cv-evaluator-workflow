import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DocumentDocument = HydratedDocument<Document>;

export type DocumentType =
  | 'cv'
  | 'project_report'
  | 'job_description'
  | 'case_study_brief'
  | 'scoring_rubric';

export type EmbeddingStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

@Schema({ timestamps: true })
export class ParsedContent {
  @Prop({ required: true })
  text: string;

  @Prop({ type: Object })
  metadata?: {
    pages?: number;
    [key: string]: any;
  };
}

@Schema({ timestamps: true })
export class Document {
  @Prop({ required: true, unique: true, index: true })
  document_id: string;

  @Prop({
    required: true,
    enum: [
      'cv',
      'project_report',
      'job_description',
      'case_study_brief',
      'scoring_rubric',
    ],
  })
  type: DocumentType;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  file_path: string;

  @Prop({ required: true })
  file_size: number;

  @Prop({ required: true })
  mime_type: string;

  @Prop({ type: ParsedContent })
  parsed_content?: ParsedContent;

  @Prop({
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  })
  embedding_status: EmbeddingStatus;

  @Prop()
  embedded_at?: Date;

  @Prop({ type: [String], default: [] })
  pinecone_ids?: string[];
}

export const DocumentSchema = SchemaFactory.createForClass(Document);

