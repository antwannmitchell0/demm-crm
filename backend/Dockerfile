# --- Stage 1: Build NestJS Application ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm install

# Copy Prisma schema & generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy application source and compile
COPY . .
RUN npm run build

# --- Stage 2: Production Runtime Image ---
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Security: create non-root user
USER node

# Copy compiled output and node_modules from builder
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma

EXPOSE 8080

CMD ["node", "dist/src/main.js"]
