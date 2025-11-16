# Multi-stage build for production

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Install dependencies
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source code
COPY . .

# Build application
RUN npm run build

# Verify build output (cek dist/src/main.js)
RUN ls -la dist/src/ && ls -la dist/src/main.js || (echo "Build failed - dist/src/main.js not found" && exit 1)

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

# Verify copied files
RUN ls -la dist/src/main.js || (echo "Copy failed - dist/src/main.js not found" && exit 1)

# Copy scripts if needed (for ingestion)
#COPY --from=builder --chown=nestjs:nodejs /app/scripts ./scripts 2>/dev/null || true

# Create uploads directory
RUN mkdir -p uploads && chown nestjs:nodejs uploads

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application - PATH YANG BENAR
CMD ["node", "dist/src/main.js"]
