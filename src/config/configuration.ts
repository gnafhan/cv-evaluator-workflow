import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  uri: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

export interface PineconeConfig {
  apiKey: string;
  environment: string;
  indexName: string;
  dimension: number;
}

export interface GoogleAIConfig {
  apiKey: string;
  primaryModel: string;
  fastModel: string;
}

export interface ModelArmorConfig {
  enabled: boolean;
  projectId: string;
  location: string;
  apiKey?: string;
  templateId?: string;
}

export interface MistralConfig {
  apiKey: string;
  ocrModel: string;
}

export interface EmbeddingConfig {
  model: string;
  dimension: number;
}

export interface FileStorageConfig {
  uploadDir: string;
  maxFileSize: number;
}

export interface QueueConfig {
  concurrency: number;
  jobTimeout: number;
}

export interface FeatureFlags {
  enableCalibrationChecks: boolean;
  enableMultiPassEvaluation: boolean;
}

export interface AppConfig {
  nodeEnv: string;
  database: DatabaseConfig;
  redis: RedisConfig;
  pinecone: PineconeConfig;
  googleAI: GoogleAIConfig;
  modelArmor: ModelArmorConfig;
  mistral: MistralConfig;
  embedding: EmbeddingConfig;
  fileStorage: FileStorageConfig;
  queue: QueueConfig;
  featureFlags: FeatureFlags;
}

export default registerAs('app', (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/cv-evaluator',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY || '',
    environment: process.env.PINECONE_ENVIRONMENT || 'us-east-1',
    indexName: process.env.PINECONE_INDEX_NAME || 'cv-evaluator-prod',
    dimension: parseInt(process.env.EMBEDDING_DIMENSION || '768', 10),
  },
  googleAI: {
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
    primaryModel: process.env.PRIMARY_MODEL || 'gemini-1.5-pro-latest',
    fastModel: process.env.FAST_MODEL || 'gemini-1.5-flash-latest',
  },
  modelArmor: {
    enabled: process.env.MODEL_ARMOR_ENABLED === 'true',
    projectId: process.env.GCP_PROJECT_ID || '',
    location: process.env.MODEL_ARMOR_LOCATION || 'asia-southeast1',
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
    templateId: process.env.MODEL_ARMOR_TEMPLATE_ID || 'cv-evaluator',
  },
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY || '',
    ocrModel: process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
  },
  embedding: {
    model: process.env.EMBEDDING_MODEL || 'text-embedding-004',
    dimension: parseInt(process.env.EMBEDDING_DIMENSION || '768', 10),
  },
  fileStorage: {
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
  },
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    jobTimeout: parseInt(process.env.JOB_TIMEOUT || '300000', 10), // 5 minutes
  },
  featureFlags: {
    enableCalibrationChecks:
      process.env.ENABLE_CALIBRATION_CHECKS === 'true',
    enableMultiPassEvaluation:
      process.env.ENABLE_MULTI_PASS_EVALUATION === 'true',
  },
}));

