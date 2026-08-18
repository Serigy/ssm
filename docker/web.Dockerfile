# syntax=docker/dockerfile:1.7
#
# Shared image for the shell and the three federated remotes.
#
#   docker build -f docker/web.Dockerfile --build-arg APP=mfe-hr -t ssm/mfe-hr:dev .
#
# Each remote is served under its own path prefix so remoteEntry.js can resolve
# its sibling chunks — PUBLIC_PATH must match the Ingress path exactly.

ARG NODE_VERSION=22.15-alpine
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION} AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json ./
COPY apps/ apps/
COPY libs/ libs/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

FROM deps AS build
ARG APP
ARG PUBLIC_PATH=/
# Baked at build time by Vite. A remote built for one path cannot be served
# from another, so the image tag and the Ingress path are bound together.
ARG API_URL=
ARG REMOTE_FINANCIAL=
ARG REMOTE_HR=
ARG REMOTE_LEGAL=
RUN test -n "$APP" || (echo "APP build-arg is required" && exit 1)

ENV VITE_PUBLIC_PATH=${PUBLIC_PATH} \
    VITE_API_URL=${API_URL} \
    VITE_REMOTE_FINANCIAL=${REMOTE_FINANCIAL} \
    VITE_REMOTE_HR=${REMOTE_HR} \
    VITE_REMOTE_LEGAL=${REMOTE_LEGAL}

RUN pnpm --filter "@ssm/${APP}" exec vite build

FROM nginx:${NGINX_VERSION} AS runtime
ARG APP
COPY --from=build /repo/apps/${APP}/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# nginx:alpine ships an unprivileged nginx user; point everything it writes at
# paths that user owns so the container can run read-only and non-root.
RUN chown -R 101:101 /usr/share/nginx/html /var/cache/nginx /var/log/nginx && \
    touch /tmp/nginx.pid && chown 101:101 /tmp/nginx.pid
USER 101:101

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
