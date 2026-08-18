# syntax=docker/dockerfile:1.7
#
# Shared image for every NestJS service. `--build-arg APP=financial-svc` picks
# which one. One Dockerfile rather than five means a base-image bump or a
# hardening change lands everywhere at once.
#
#   docker build -f docker/service.Dockerfile --build-arg APP=hr-svc -t ssm/hr-svc:dev .

ARG NODE_VERSION=22.15-alpine

# --- deps -------------------------------------------------------------------
# Installs the full workspace once. Cached until a manifest or the lockfile
# changes, so editing source never re-runs the install.
FROM node:${NODE_VERSION} AS deps
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json ./
COPY apps/ apps/
COPY libs/ libs/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM deps AS build
ARG APP
RUN test -n "$APP" || (echo "APP build-arg is required" && exit 1)
RUN pnpm exec nest build -p apps/${APP}/tsconfig.build.json

# tsc emits a tree rooted at the workspace, because each service compiles the
# shared libs from source alongside its own code. Rather than leak that layout
# into the Dockerfile CMD, the Helm Job and every runbook, generate two stable
# entry points that forward into it.
RUN cd apps/${APP}/dist && \
    printf 'require("./apps/%s/src/main.js");\n' "${APP}" > main.js && \
    printf 'module.exports = require("./apps/%s/src/database/data-source.js");\n' "${APP}" > data-source.js

# Prune to production dependencies for just this app, so the runtime image
# carries no compilers, no test frameworks and no sibling services.
RUN pnpm --filter "@ssm/${APP}..." deploy --prod --legacy /out

# --- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ARG APP
ENV NODE_ENV=production \
    SSM_SECRETS_DIR=/run/secrets \
    NODE_OPTIONS="--enable-source-maps"

# dumb-init reaps zombies and forwards SIGTERM, so Nest's shutdown hooks
# actually run and the AMQP channel drains before the pod dies.
RUN apk add --no-cache dumb-init curl && \
    addgroup -g 10001 -S ssm && \
    adduser -u 10001 -S -G ssm -h /app ssm

WORKDIR /app
COPY --from=build --chown=ssm:ssm /out/node_modules ./node_modules
COPY --from=build --chown=ssm:ssm /repo/apps/${APP}/dist ./dist

# Non-root, and the filesystem is read-only at runtime (see the Helm
# securityContext) — nothing here writes to disk.
USER 10001:10001

EXPOSE 3000
STOPSIGNAL SIGTERM

# Compose uses this; Kubernetes uses its own probes and ignores it.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3000}/health/live || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
