# AI-Powered CV & Project Evaluation System

A backend service that automates initial screening of job applications by evaluating candidate CVs and project reports against job descriptions and case study briefs using AI-powered analysis with RAG (Retrieval-Augmented Generation).

## Features

- **Document Upload**: Upload CV and project report PDFs
- **Asynchronous Evaluation**: Queue-based processing with progress tracking
- **Multi-Stage AI Pipeline**: 
  - CV parsing and evaluation
  - Project report evaluation
  - Final synthesis
- **RAG Integration**: Semantic search using Pinecone for context retrieval
- **Progress Tracking**: Real-time job status and progress updates
- **Error Handling**: Robust retry logic with exponential backoff
- **Security Screening**: Google Cloud Model Armor integration to screen PDFs and prompts for malicious content, prompt injection, and sensitive data

## Technology Stack

- **Backend Framework**: NestJS with TypeScript
- **Database**: MongoDB (document storage, evaluation results, job tracking)
- **Queue/Job Management**: Redis + BullMQ
- **AI Framework**: Vercel AI SDK
- **LLM Provider**: Google Generative AI (Gemini 1.5 Pro/Flash)
- **Vector Database**: Pinecone (RAG/semantic search)
- **PDF Processing**: Mistral AI OCR (Document AI)
- **File Storage**: Local filesystem

## Prerequisites

- Node.js 18+ and npm (for local development)
- Docker and Docker Compose (for production deployment)
- MongoDB (via Docker or standalone)
- Redis (via Docker or standalone)
- Pinecone account and API key
- Google Generative AI API key
- Mistral AI API key (for OCR processing)
- Traefik reverse proxy (for production)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd cv-corrector
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and fill in your credentials:
   - `MONGODB_URI`: MongoDB connection string
   - `REDIS_HOST` and `REDIS_PORT`: Redis connection details
   - `PINECONE_API_KEY`: Your Pinecone API key
   - `GOOGLE_GENERATIVE_AI_API_KEY`: Your Google AI API key
   - `MISTRAL_API_KEY`: Your Mistral AI API key (for OCR processing)
   - `MISTRAL_OCR_MODEL`: Mistral OCR model (default: `mistral-ocr-latest`)
   - `MODEL_ARMOR_ENABLED`: Enable Model Armor security screening (default: `false`)
   - `GCP_PROJECT_ID`: Your Google Cloud Project ID (required if Model Armor is enabled)
   - `MODEL_ARMOR_LOCATION`: Model Armor location (default: `asia-southeast1`)
   - `MODEL_ARMOR_TEMPLATE_ID`: Optional template ID (if not provided, a default template will be created automatically)

5. **Configure GCP Service Account Permissions** (Required for Model Armor):
   
   Your service account needs the following IAM roles/permissions:
   
   **Minimum Required Permissions:**
   - `modelarmor.templates.use` - To use templates for sanitization
   - `modelarmor.templates.get` - To verify/get template details (optional, for verification only)
   - `modelarmor.templates.create` - Only if you want to auto-create templates (optional)
   
   **Recommended IAM Roles:**
   - **Security Command Center Admin** (`roles/securitycenter.admin`) - Full access to Model Armor
   - **OR** **Model Armor User** (`roles/modelarmor.user`) - If available in your GCP project
   
   **To Grant Permissions:**
   1. Go to GCP Console → IAM & Admin → IAM
   2. Find your service account (or create one)
   3. Click "Edit" → "Add Another Role"
   4. Add one of the roles above
   5. Save
   
   **Service Account Authentication:**
   - Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable to path of service account JSON key file
   - OR use Application Default Credentials if running on GCP (Cloud Run, GCE, etc.)
   
   Example:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
   ```
   
   - Other configuration values as needed

4. **Start Docker services**
```bash
   docker-compose up -d
   ```
   
   This starts MongoDB and Redis containers.

5. **Ingest system documents**
   ```bash
   npm run ingest:documents
   ```
   
   This loads job descriptions, scoring rubrics, and case study briefs into Pinecone.

6. **Start the application**
```bash
   # Development mode
   npm run start:dev
   
   # Production mode
   npm run build
   npm run start:prod
   ```

The application will be available at `http://localhost:3000`.

## Docker Deployment

### Production Deployment with Traefik

The service can be deployed as a Docker container and integrated with Traefik reverse proxy for production.

#### Prerequisites

- Docker and Docker Compose
- Traefik reverse proxy already running
- External network `traefik_network` created (shared with Traefik)

#### Setup

1. **Create external network** (if not already exists):
   ```bash
   docker network create traefik_network
   ```

2. **Set environment variables**:
   Create a `.env` file in the project root with all required environment variables:
   ```env
   # Domain Configuration (for Traefik)
   SUBDOMAIN=cv-corrector
   DOMAIN_NAME=yourdomain.com
   
   # MongoDB
   MONGODB_URI=mongodb://mongodb:27017/cv-evaluator
   
   # Redis
   REDIS_HOST=redis
   REDIS_PORT=6379
   
   # Pinecone
   PINECONE_API_KEY=your-pinecone-api-key
   PINECONE_INDEX_NAME=your-index-name
   
   # Google AI (Gemini)
   GOOGLE_GENERATIVE_AI_API_KEY=your-google-ai-api-key
   
   # Mistral AI (OCR)
   MISTRAL_API_KEY=your-mistral-api-key
   
   # Google Cloud Model Armor
   MODEL_ARMOR_ENABLED=true
   GCP_PROJECT_ID=your-gcp-project-id
   MODEL_ARMOR_LOCATION=asia-southeast1
   MODEL_ARMOR_TEMPLATE_ID=cv-evaluator
   ```

3. **Build and start the service**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

4. **Check logs**:
   ```bash
   docker-compose -f docker-compose.prod.yml logs -f cv-corrector
   ```

5. **Access the service**:
   The service will be available at `https://${SUBDOMAIN}.${DOMAIN_NAME}` (configured via Traefik).

#### Docker Compose Configuration

The `docker-compose.prod.yml` includes:

- **cv-corrector**: Main NestJS application
  - Multi-stage build for optimized production image
  - Non-root user for security
  - Health checks enabled
  - Traefik labels for automatic SSL and routing

- **mongodb**: MongoDB database
  - Persistent volume for data

- **redis**: Redis cache/queue
  - Persistent volume for data

All services are connected to the `traefik_network` external network.

#### Traefik Integration

The service is automatically configured with Traefik labels:

- **SSL/TLS**: Automatic Let's Encrypt certificates
- **HTTPS Redirect**: HTTP traffic automatically redirected to HTTPS
- **Security Headers**: HSTS, XSS protection, content type sniffing protection
- **Host-based Routing**: Routes based on `${SUBDOMAIN}.${DOMAIN_NAME}`

#### Building the Docker Image

To build the image manually:

```bash
docker build -t cv-corrector:latest .
```

The Dockerfile uses multi-stage build for optimization:
- **Builder stage**: Installs all dependencies and builds the application
- **Production stage**: Only includes production dependencies and built files

#### Stopping the Service

```bash
docker-compose -f docker-compose.prod.yml down
```

To also remove volumes (⚠️ **this will delete data**):

```bash
docker-compose -f docker-compose.prod.yml down -v
```

## CI/CD with GitHub Actions

The repository includes GitHub Actions workflow for automated build and deployment.

### Setup

1. **Add GitHub Secrets**:
   - Go to repository → Settings → Secrets and variables → Actions
   - Add the following secrets:
     - `SERVER_IP`: Your server IP address
     - `USERNAME`: SSH username (e.g., `root`)
     - `SERVER_KEY`: SSH private key for authentication

2. **Generate SSH Key** (if needed):
   ```bash
   ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions_deploy
   ```
   
   - Copy **private key** to GitHub Secrets as `SERVER_KEY`
   - Add **public key** to server:
     ```bash
     ssh-copy-id -i ~/.ssh/github_actions_deploy.pub root@your-server-ip
     ```

3. **Workflow Triggers**:
   - Automatically runs on push to `main` branch
   - Can be manually triggered from Actions tab

### What the Workflow Does

1. **Build Job**:
   - Installs dependencies
   - Runs linter
   - Builds application
   - Verifies build output

2. **Deploy Job**:
   - Connects to server via SSH
   - Pulls latest code from `main` branch
   - Rebuilds Docker image
   - Restarts services
   - Verifies deployment

See `.github/workflows/README.md` for detailed setup instructions.

## API Endpoints

### POST /upload

Upload candidate CV and project report.

**Request**: `multipart/form-data`
- `cv`: CV PDF file
- `project_report`: Project report PDF file

**Response** (201 Created):
```json
{
  "cv_id": "doc_cv_1234567890",
  "project_report_id": "doc_pr_1234567890",
  "uploaded_at": "2024-01-15T10:30:00Z"
}
```

### POST /evaluate

Trigger asynchronous evaluation pipeline.

**Request**:
```json
{
  "job_title": "Backend Developer",
  "cv_id": "doc_cv_1234567890",
  "project_report_id": "doc_pr_1234567890"
}
```

**Response** (202 Accepted):
```json
{
  "id": "eval_job_9876543210",
  "status": "queued",
  "created_at": "2024-01-15T10:31:00Z"
}
```

### GET /result/:id

Retrieve evaluation status and results.

**Response - Processing** (200 OK):
```json
{
  "id": "eval_job_9876543210",
  "status": "processing",
  "current_stage": "cv_evaluation",
  "progress_percentage": 30,
  "created_at": "2024-01-15T10:31:00Z",
  "started_at": "2024-01-15T10:31:05Z"
}
```

**Response - Completed** (200 OK):
```json
{
  "id": "eval_job_9876543210",
  "status": "completed",
  "result": {
    "cv_match_rate": 0.82,
    "cv_feedback": "Strong in backend and cloud technologies...",
    "cv_scoring_breakdown": {
      "technical_skills_match": {
        "score": 4,
        "weight": 0.4,
        "weighted_score": 1.6
      },
      ...
    },
    "project_score": 4.5,
    "project_feedback": "Excellent implementation...",
    "project_scoring_breakdown": {
      "correctness": {
        "score": 5,
        "weight": 0.3,
        "weighted_score": 1.5
      },
      ...
    },
    "overall_summary": "Strong candidate with solid backend engineering..."
  },
  "completed_at": "2024-01-15T10:35:00Z",
  "processing_time_seconds": 235
}
```

### GET /health

Health check endpoint.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "services": {
    "mongodb": "connected"
  }
}
```

## Architecture

### Module Structure

```
src/
├── config/              # Configuration management
├── database/            # MongoDB schemas and connection
├── documents/           # Document upload and storage
├── rag/                 # RAG & vector operations
├── ai/                  # AI/LLM integration
├── evaluation/          # Evaluation orchestration
├── queue/               # BullMQ configuration
├── common/              # Shared filters and interceptors
└── health/              # Health check endpoint
```

### Evaluation Pipeline

1. **Document Upload**: PDFs are parsed and stored
2. **Job Creation**: Evaluation job is created and queued
3. **CV Parsing**: Extract structured data from CV
4. **CV Evaluation**: RAG retrieval + LLM evaluation against job requirements
5. **Project Parsing**: Extract structure from project report
6. **Project Evaluation**: RAG retrieval + LLM evaluation against case study
7. **Final Synthesis**: Combine results into overall summary
8. **Result Storage**: Store complete evaluation in database

### RAG Strategy

- **Embeddings**: Google text-embedding-004 (768 dimensions)
- **Vector Database**: Pinecone with namespaces for different document types
- **Chunking**: Semantic chunking with 500-800 token chunks and 100 token overlap
- **Retrieval**: Top-k semantic search with metadata filtering

## Configuration

Key environment variables:

- `MONGODB_URI`: MongoDB connection string
- `REDIS_HOST`, `REDIS_PORT`: Redis connection
- `PINECONE_API_KEY`: Pinecone API key
- `PINECONE_INDEX_NAME`: Pinecone index name
- `GOOGLE_GENERATIVE_AI_API_KEY`: Google AI API key
- `PRIMARY_MODEL`: Primary Gemini model (default: gemini-1.5-pro-latest)
- `FAST_MODEL`: Fast Gemini model (default: gemini-1.5-flash-latest)
- `UPLOAD_DIR`: File upload directory (default: ./uploads)
- `MAX_FILE_SIZE`: Maximum file size in bytes (default: 10485760 = 10MB)
- `QUEUE_CONCURRENCY`: Number of concurrent job processors (default: 5)

## Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## Development

### Project Structure

The project follows NestJS best practices with modular architecture:

- **Modules**: Each feature is a self-contained module
- **Services**: Business logic in services
- **Controllers**: HTTP endpoints in controllers
- **DTOs**: Data transfer objects for validation
- **Schemas**: MongoDB schemas for data persistence

### Code Patterns

- **Error Handling**: Global exception filters with retry logic
- **Validation**: DTOs with class-validator decorators
- **Logging**: Structured logging with NestJS Logger
- **Configuration**: Centralized config with @nestjs/config

## Deployment

### Production Checklist

- [ ] Environment variables configured
- [ ] MongoDB connection string set
- [ ] Redis connection configured
- [ ] Pinecone index created and configured
- [ ] LLM API key validated
- [ ] System documents ingested into Pinecone
- [ ] File upload directory created with proper permissions
- [ ] Queue workers started
- [ ] Health check endpoint verified
- [ ] Logging configured
- [ ] Error tracking configured (optional: Sentry)

### Docker Deployment

The `docker-compose.yml` file includes MongoDB and Redis. For production, consider:

- Using managed database services (MongoDB Atlas, Redis Cloud)
- Setting up proper volume mounts for file storage
- Configuring environment variables securely
- Setting up monitoring and alerting

## Troubleshooting

### Common Issues

1. **MongoDB connection failed**
   - Check `MONGODB_URI` in `.env`
   - Ensure MongoDB is running: `docker-compose ps`

2. **Redis connection failed**
   - Check `REDIS_HOST` and `REDIS_PORT` in `.env`
   - Ensure Redis is running: `docker-compose ps`

3. **Pinecone errors**
   - Verify `PINECONE_API_KEY` is set
   - Check Pinecone index exists and dimension matches (768)

4. **LLM API errors**
   - Verify `GOOGLE_GENERATIVE_AI_API_KEY` is set
   - Check API rate limits and quotas
   - Review error logs for specific error messages

5. **File upload fails**
   - Ensure `UPLOAD_DIR` exists and is writable
   - Check `MAX_FILE_SIZE` setting
   - Verify PDF files are valid and text-based

## License

MIT

## Support

For issues and questions, please open an issue on the repository.
