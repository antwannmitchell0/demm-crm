# --- Stage 1: Install Dependencies ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# --- Stage 2: Build Application ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# Signals scripts/verify-production-config.js and
# scripts/verify-no-localhost-in-bundle.js (npm prebuild/postbuild hooks)
# to actually enforce their checks. Safe to set here: node_modules was
# already installed in Stage 1 before this ENV takes effect, so it can't
# suppress devDependency installation the way setting it before `npm
# install` would.
ENV NODE_ENV=production

# NEXT_PUBLIC_* vars are inlined by Next.js at build time, not read at
# runtime -- setting this on the Cloud Run *service* does nothing. It must
# be present here, before `next build` runs, or the bundle silently keeps
# whatever fallback is in source (previously the hardcoded localhost URL).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# --- Stage 3: Production Runner ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Server-side only (read by src/app/api/version/route.ts) -- deliberately
# NOT NEXT_PUBLIC_*, so it's set here in the runner stage rather than
# baked into the client bundle in the builder stage above.
ARG GIT_COMMIT_SHA=UNKNOWN_COMMIT
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
ARG BUILD_TIMESTAMP=""
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
