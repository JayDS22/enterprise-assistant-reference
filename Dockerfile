# Multi-stage build for Next 15 standalone output on Fly.
# Final image is ~200-280MB. If it grows past 400MB, something leaked —
# check .dockerignore and `output: 'standalone'` in next.config.ts.

FROM node:20-alpine AS builder
WORKDIR /app

# Enable pnpm via corepack. Pins the version from package.json#packageManager.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --prod=false

COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root runtime user; Alpine's shadow package would add bloat, so useradd.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# Standalone output + static assets + public dir.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
