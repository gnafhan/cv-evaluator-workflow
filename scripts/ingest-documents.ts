import * as fs from 'fs/promises';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RagService } from '../src/rag/rag.service';
import { DocumentsService } from '../src/documents/documents.service';
import { ConfigService } from '@nestjs/config';

async function ingestDocuments() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ragService = app.get(RagService);
  const documentsService = app.get(DocumentsService);
  const configService = app.get(ConfigService);

  console.log('Starting document ingestion...');

  // Clear existing data from namespaces
  console.log('Clearing existing data from vector database...');
  try {
    await ragService.deleteNamespace('job_descriptions');
    await ragService.deleteNamespace('case_studies');
    await ragService.deleteNamespace('scoring_rubrics');
    console.log('✓ Cleared existing namespaces');
  } catch (error: any) {
    console.warn(`Warning: Could not clear namespaces: ${error.message}`);
  }

  const groundedKnowledgePath = path.join(process.cwd(), 'grounded_knowledge');

  // 1. Ingest Backend Engineer Specification (for CV evaluation)
  console.log('\n📄 Processing Backend Engineer Specification.pdf...');
  try {
    const backendSpecPath = path.join(groundedKnowledgePath, 'Backend Engineer Specification.pdf');
    
    // Check if file exists
    try {
      await fs.access(backendSpecPath);
    } catch {
      throw new Error(`File not found: ${backendSpecPath}`);
    }

    // Extract text using Mistral OCR
    console.log('  Extracting text from PDF...');
    const parsedContent = await documentsService.parsePDF(backendSpecPath);
    const jobDescriptionText = parsedContent.text;

    if (!jobDescriptionText || jobDescriptionText.trim().length === 0) {
      throw new Error('No text extracted from PDF');
    }

    console.log(`  Extracted ${jobDescriptionText.length} characters from PDF`);
    console.log('  Chunking text...');
    const chunks = ragService.chunkText(jobDescriptionText, 500, 100);
    
    console.log(`  Ingesting ${chunks.length} chunks to Pinecone...`);
    await ragService.upsertChunks(chunks, {
      document_type: 'job_description',
      job_title: 'Backend Engineer',
      namespace: 'job_descriptions',
    });

    console.log(`✓ Successfully ingested ${chunks.length} chunks for Backend Engineer Specification`);
  } catch (error: any) {
    console.error('✗ Failed to ingest Backend Engineer Specification:', error.message);
    throw error;
  }

  // 2. Ingest Case Study Brief (for project evaluation)
  console.log('\n📄 Processing Case Study Brief - Backend.pdf...');
  try {
    const caseStudyPath = path.join(groundedKnowledgePath, 'Case Study Brief - Backend.pdf');
    
    // Check if file exists
    try {
      await fs.access(caseStudyPath);
    } catch {
      throw new Error(`File not found: ${caseStudyPath}`);
    }

    // Extract text using Mistral OCR
    console.log('  Extracting text from PDF...');
    const parsedContent = await documentsService.parsePDF(caseStudyPath);
    const caseStudyText = parsedContent.text;

    if (!caseStudyText || caseStudyText.trim().length === 0) {
      throw new Error('No text extracted from PDF');
    }

    console.log(`  Extracted ${caseStudyText.length} characters from PDF`);
    console.log('  Chunking text...');
    const chunks = ragService.chunkText(caseStudyText, 500, 100);
    
    console.log(`  Ingesting ${chunks.length} chunks to Pinecone...`);
    await ragService.upsertChunks(chunks, {
      document_type: 'case_study_brief',
      job_title: 'Backend Engineer',
      namespace: 'case_studies',
    });

    console.log(`✓ Successfully ingested ${chunks.length} chunks for Case Study Brief`);
  } catch (error: any) {
    console.error('✗ Failed to ingest Case Study Brief:', error.message);
    throw error;
  }

  // 3. Ingest scoring rubrics (for both CV and Project evaluation)
  console.log('\n📋 Ingesting scoring rubrics...');
  
  const cvRubricText = `
    CV Match Evaluation Rubric (1-5 scale per parameter)
    
    Technical Skills Match (Weight: 40%):
    Description: Alignment with job requirements (backend, databases, APIs, cloud, AI/LLM).
    Scoring Guide:
    - 1 = Irrelevant skills
    - 2 = Few overlaps
    - 3 = Partial match
    - 4 = Strong match
    - 5 = Excellent match + AI/LLM exposure
    
    Experience Level (Weight: 25%):
    Description: Years of experience and project complexity.
    Scoring Guide:
    - 1 = <1 yr / trivial projects
    - 2 = 1-2 yrs
    - 3 = 2-3 yrs with mid-scale projects
    - 4 = 3-4 yrs solid track record
    - 5 = 5+ yrs / high-impact projects
    
    Relevant Achievements (Weight: 20%):
    Description: Impact of past work (scaling, performance, adoption).
    Scoring Guide:
    - 1 = No clear achievements
    - 2 = Minimal improvements
    - 3 = Some measurable outcomes
    - 4 = Significant contributions
    - 5 = Major measurable impact
    
    Cultural / Collaboration Fit (Weight: 15%):
    Description: Communication, learning mindset, teamwork/leadership.
    Scoring Guide:
    - 1 = Not demonstrated
    - 2 = Minimal
    - 3 = Average
    - 4 = Good
    - 5 = Excellent and well-demonstrated
  `;

  try {
    console.log('  Processing CV scoring rubric...');
    const cvRubricChunks = ragService.chunkText(cvRubricText, 500, 100);
    
    await ragService.upsertChunks(cvRubricChunks, {
      document_type: 'cv_scoring_rubric',
      namespace: 'scoring_rubrics',
    });

    console.log(`✓ Ingested ${cvRubricChunks.length} chunks for CV scoring rubric`);
  } catch (error: any) {
    console.error('✗ Failed to ingest CV rubric:', error.message);
  }

  const projectRubricText = `
    Project Deliverable Evaluation Rubric (1-5 scale per parameter)
    
    Correctness (Prompt & Chaining) (Weight: 30%):
    Description: Implements prompt design, LLM chaining, RAG context injection.
    Scoring Guide:
    - 1 = Not implemented
    - 2 = Minimal attempt
    - 3 = Works partially
    - 4 = Works correctly
    - 5 = Fully correct + thoughtful
    
    Code Quality & Structure (Weight: 25%):
    Description: Clean, modular, reusable, tested.
    Scoring Guide:
    - 1 = Poor
    - 2 = Some structure
    - 3 = Decent modularity
    - 4 = Good structure + some tests
    - 5 = Excellent quality + strong tests
    
    Resilience & Error Handling (Weight: 20%):
    Description: Handles long jobs, retries, randomness, API failures.
    Scoring Guide:
    - 1 = Missing
    - 2 = Minimal
    - 3 = Partial handling
    - 4 = Solid handling
    - 5 = Robust, production-ready
    
    Documentation & Explanation (Weight: 15%):
    Description: README clarity, setup instructions, trade-off explanations.
    Scoring Guide:
    - 1 = Missing
    - 2 = Minimal
    - 3 = Adequate
    - 4 = Clear
    - 5 = Excellent + insightful
    
    Creativity / Bonus (Weight: 10%):
    Description: Extra features beyond requirements.
    Scoring Guide:
    - 1 = None
    - 2 = Very basic
    - 3 = Useful extras
    - 4 = Strong enhancements
    - 5 = Outstanding creativity
  `;

  try {
    console.log('  Processing project scoring rubric...');
    const projectRubricChunks = ragService.chunkText(projectRubricText, 500, 100);
    
    await ragService.upsertChunks(projectRubricChunks, {
      document_type: 'project_scoring_rubric',
      namespace: 'scoring_rubrics',
    });

    console.log(`✓ Ingested ${projectRubricChunks.length} chunks for project scoring rubric`);
  } catch (error: any) {
    console.error('✗ Failed to ingest project rubric:', error.message);
  }

  console.log('\n✅ Document ingestion completed!');
  await app.close();
}

ingestDocuments().catch((error) => {
  console.error('Fatal error during ingestion:', error);
  process.exit(1);
});

