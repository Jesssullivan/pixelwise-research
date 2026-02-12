# syntax=docker/dockerfile:1

# Multi-stage build for pixelwise SvelteKit app
# Produces a minimal Node 22 Alpine image with adapter-node output

# ──────────────────────────────────────────────
# Stage 1: Install dependencies and build
# ──────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable pnpm

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and pre-built Futhark WASM artifacts
COPY . .

# Build SvelteKit with adapter-node
RUN pnpm build

# Prune devDependencies for production
RUN pnpm prune --prod

# ──────────────────────────────────────────────
# Stage 2: Production image
# ──────────────────────────────────────────────
FROM node:22-alpine AS production

RUN apk add --no-cache dumb-init

# Non-root user
RUN addgroup -g 1001 -S pixelwise && \
    adduser -S pixelwise -u 1001 -G pixelwise

WORKDIR /app

# Copy build output and production dependencies
COPY --from=builder --chown=pixelwise:pixelwise /app/dist ./dist
COPY --from=builder --chown=pixelwise:pixelwise /app/node_modules ./node_modules
COPY --from=builder --chown=pixelwise:pixelwise /app/package.json ./

USER pixelwise

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist"]
