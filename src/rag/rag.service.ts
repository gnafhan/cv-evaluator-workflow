import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { Chunk, RetrievedChunk } from './types/chunk.types';

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private pineconeClient: Pinecone;
  private pineconeIndex: any;
  private readonly indexName: string;
  private readonly dimension: number;
  private readonly embeddingApiKey: string;

  constructor(private configService: ConfigService) {
    const config = this.configService.get<{
      pinecone: { apiKey: string; indexName: string; dimension: number };
      googleAI: { apiKey: string };
    }>('app');

    this.indexName = config?.pinecone.indexName || 'cv-evaluator-prod';
    this.dimension = config?.pinecone.dimension || 768;
    this.embeddingApiKey = config?.googleAI.apiKey || '';

    if (!config?.pinecone.apiKey) {
      this.logger.warn('Pinecone API key not configured');
    } else {
      this.pineconeClient = new Pinecone({
        apiKey: config.pinecone.apiKey,
      });
    }
  }

  async onModuleInit() {
    if (this.pineconeClient) {
      try {
        this.pineconeIndex = this.pineconeClient.index(this.indexName);
        this.logger.log(`Connected to Pinecone index: ${this.indexName}`);
      } catch (error) {
        this.logger.error(`Failed to connect to Pinecone: ${error.message}`);
      }
    }
  }

  async embedText(text: string): Promise<number[]> {
    // Use Google's text-embedding-004 model
    if (!this.embeddingApiKey) {
      throw new Error('Google AI API key not configured for embeddings');
    }

    const maxRetries = 3;
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.embeddingApiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'models/text-embedding-004',
              content: {
                parts: [{ text: text }],
              },
            }),
            // Increase timeout for large batches
            signal: AbortSignal.timeout(30000), // 30 second timeout
          },
        );

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Embedding API error: ${error}`);
        }

        const data = await response.json();
        return data.embedding.values;
      } catch (error: any) {
        lastError = error;
        
        // Retry on timeout or network errors
        if (
          (error.code === 'UND_ERR_CONNECT_TIMEOUT' || 
           error.message?.includes('timeout') ||
           error.message?.includes('fetch failed')) &&
          attempt < maxRetries
        ) {
          const delay = attempt * 2000; // Exponential backoff: 2s, 4s, 6s
          this.logger.warn(`Embedding attempt ${attempt} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        this.logger.error(`Failed to generate embedding (attempt ${attempt}): ${error.message}`);
        throw error;
      }
    }

    throw lastError!;
  }

  chunkText(
    text: string,
    chunkSize: number = 500,
    overlap: number = 100,
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const words = text.split(/\s+/);
    let currentChunk: string[] = [];
    let currentLength = 0;
    let chunkIndex = 0;

    for (const word of words) {
      const wordLength = word.length + 1; // +1 for space

      if (currentLength + wordLength > chunkSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          content: currentChunk.join(' '),
          metadata: {
            chunk_index: chunkIndex++,
          },
        });

        // Start new chunk with overlap
        const overlapWords = currentChunk.slice(-overlap);
        currentChunk = overlapWords;
        currentLength = overlapWords.join(' ').length;
      }

      currentChunk.push(word);
      currentLength += wordLength;
    }

    // Add remaining chunk
    if (currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join(' '),
        metadata: {
          chunk_index: chunkIndex,
        },
      });
    }

    return chunks;
  }

  async upsertChunks(
    chunks: Chunk[],
    metadata: {
      document_type: string;
      job_title?: string;
      namespace?: string;
    },
  ): Promise<void> {
    if (!this.pineconeIndex) {
      throw new Error('Pinecone index not initialized');
    }

    try {
      // Generate embeddings for all chunks in batches to avoid overwhelming the API
      const embeddings: number[][] = [];
      const embeddingBatchSize = 10; // Process 10 chunks at a time for embeddings
      
      for (let i = 0; i < chunks.length; i += embeddingBatchSize) {
        const batch = chunks.slice(i, i + embeddingBatchSize);
        this.logger.debug(`Generating embeddings for batch ${Math.floor(i / embeddingBatchSize) + 1}/${Math.ceil(chunks.length / embeddingBatchSize)}`);
        
        const batchEmbeddings = await Promise.all(
          batch.map((chunk) => this.embedText(chunk.content)),
        );
        
        embeddings.push(...batchEmbeddings);
        
        // Small delay between batches to avoid rate limiting
        if (i + embeddingBatchSize < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Prepare vectors for upsert
      const vectors = chunks.map((chunk, index) => ({
        id: `${metadata.document_type}_${metadata.job_title || 'default'}_chunk_${chunk.metadata.chunk_index}`,
        values: embeddings[index],
        metadata: {
          ...chunk.metadata,
          ...metadata,
          content: chunk.content,
        },
      }));

      // Upsert in batches
      const upsertBatchSize = 100;
      for (let i = 0; i < vectors.length; i += upsertBatchSize) {
        const batch = vectors.slice(i, i + upsertBatchSize);
        const namespace = metadata.namespace || 'default';
        
        await this.pineconeIndex.namespace(namespace).upsert(batch);
      }

      this.logger.log(`Upserted ${vectors.length} chunks to Pinecone`);
    } catch (error) {
      this.logger.error(`Failed to upsert chunks: ${error.message}`);
      throw error;
    }
  }

  async query(
    queryText: string,
    filters: object,
    topK: number = 8,
    namespace?: string,
  ): Promise<RetrievedChunk[]> {
    if (!this.pineconeIndex) {
      throw new Error('Pinecone index not initialized');
    }

    try {
      const queryEmbedding = await this.embedText(queryText);
      const ns = namespace || 'default';

      const queryResponse = await this.pineconeIndex
        .namespace(ns)
        .query({
          vector: queryEmbedding,
          topK,
          filter: filters,
          includeMetadata: true,
        });

      return queryResponse.matches.map((match: any) => ({
        content: match.metadata.content as string,
        score: match.score || 0,
        metadata: {
          ...match.metadata,
        },
      }));
    } catch (error) {
      this.logger.error(`Failed to query Pinecone: ${error.message}`);
      throw error;
    }
  }

  async queryHybrid(
    queryText: string,
    filters: object,
    topK: number = 8,
    namespace?: string,
  ): Promise<RetrievedChunk[]> {
    // For now, use semantic search only
    // In production, you might want to combine with keyword search
    return this.query(queryText, filters, topK, namespace);
  }

  /**
   * Delete all vectors from a namespace
   */
  async deleteNamespace(namespace: string): Promise<void> {
    if (!this.pineconeIndex) {
      throw new Error('Pinecone index not initialized');
    }

    try {
      // Pinecone doesn't have a direct deleteNamespace method
      // We need to delete all vectors with filter or deleteAll
      const ns = namespace || 'default';
      await this.pineconeIndex.namespace(ns).deleteAll();
      this.logger.log(`Deleted all vectors from namespace: ${ns}`);
    } catch (error) {
      this.logger.error(`Failed to delete namespace ${namespace}: ${error.message}`);
      throw error;
    }
  }
}

