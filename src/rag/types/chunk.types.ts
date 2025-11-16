export interface Chunk {
  content: string;
  metadata: {
    document_type?: string;
    job_title?: string;
    section?: string;
    chunk_index: number;
    [key: string]: any;
  };
}

export interface RetrievedChunk {
  content: string;
  score: number;
  metadata: {
    document_type?: string;
    job_title?: string;
    section?: string;
    chunk_index: number;
    [key: string]: any;
  };
}

