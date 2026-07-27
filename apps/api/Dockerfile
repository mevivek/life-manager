# syntax=docker/dockerfile:1

# The API image, for Fly.io (ADR-0014). Built from the REPO ROOT, not from apps/api:
#
#     docker build -f apps/api/Dockerfile .
#
# fly.toml's [build] dockerfile setting handles that. A build context of apps/api alone cannot
# see pnpm-lock.yaml or packages/shared, and the failure is a confusing "lockfile not found".

FROM node:22-alpine AS base
# pnpm 11 waits on an interactive prompt for build scripts when there is no TTY, which in a
# container looks precisely like a hang with no output.
ENV CI=true
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm
WORKDIR /repo


FROM base AS build
# Copy manifests first so the dependency layer caches independently of source changes.
# pnpm-workspace.yaml is NOT optional here: pnpm 11 keeps its settings in it, so without it
# `allowBuilds` and `injectWorkspacePackages` silently do not apply and `pnpm deploy` refuses.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @life-manager/api... --filter @life-manager/shared

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @life-manager/shared build \
 && pnpm --filter @life-manager/api build

# `--legacy` because pnpm 10+ refuses `deploy` in a workspace unless
# injectWorkspacePackages is set; we set it, and --legacy keeps the flat node_modules layout
# that a plain `node dist/server.js` can resolve.
RUN pnpm --filter @life-manager/api deploy --prod --legacy /out


FROM base AS runtime
ENV NODE_ENV=production
# Fly's convention, and fly.toml's internal_port must match.
ENV PORT=8080
ENV HOST=0.0.0.0

# `node` (uid 1000) ships with the image. Never run as root.
WORKDIR /app
COPY --from=build --chown=node:node /out /app
# Migrations are applied by fly.toml's release_command, which runs this same image, so the
# generated SQL has to be present in it.
COPY --from=build --chown=node:node /repo/apps/api/drizzle /app/drizzle

USER node
EXPOSE 8080

# No secrets are baked in. Everything comes from `fly secrets set` at runtime, and src/env.ts
# refuses to boot if any of it is missing (security-model.md §6).
CMD ["node", "dist/server.js"]
