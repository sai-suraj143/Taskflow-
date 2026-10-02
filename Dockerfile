# syntax=docker/dockerfile:1

# One image, two services.
#
# Both `api` and `worker` in docker-compose.yml are built from THIS file and run
# different `command`s; there is deliberately no api-specific or worker-specific
# Dockerfile and no baked-in CMD that assumes one role over the other. The final CMD is
# only a sensible default (`node src/server.js`) that compose overrides per service.
#
# Base image: node:22-alpine, chosen to match the Node 22 runtime this project is
# developed and tested on (`node -v` -> v22.23.1). Matching the dev runtime matters more
# than saving ~40MB of image size: native ESM behaviour, --env-file and the
# --experimental-vm-modules path used by `npm test` are all Node-version sensitive.
# Alpine is safe here because bcrypt 6 ships a prebuilt musl binding
# (prebuilds/linux-x64/bcrypt.musl.node), so no C toolchain is needed in the image.
# openssl + libc6-compat are still required by Prisma's query/schema engines.

# ---------------------------------------------------------------------------
# Stage 1: build — full install, Prisma client generation
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

# package*.json are copied on their own so the (slow) dependency layer is only
# invalidated when the manifest/lockfile actually changes.
COPY package.json package-lock.json ./

# npm ci, not npm install: installs the exact versions pinned in package-lock.json,
# which is what makes the image reproducible. Dev dependencies ARE needed here because
# the `prisma` CLI itself is a devDependency.
RUN npm ci

COPY prisma ./prisma

# Generates node_modules/.prisma/client (the query engine + typed client). It must run
# inside the build stage so the runtime image never needs the prisma devDependency.
RUN npx prisma generate

COPY src ./src

# ---------------------------------------------------------------------------
# Stage 2: runtime — production dependencies + source only
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./

# Pruned to production dependencies. Chosen over copying the build stage's full
# node_modules and running `npm prune` afterwards because prune rewrites the tree in
# place and can drop the files Prisma generated into node_modules/.prisma, whereas a
# fresh `npm ci --omit=dev` is deterministic and provably contains no dev-only packages.
#
# Verified empirically rather than assumed: the `api` service must run
# `npx prisma migrate deploy` on startup, and `prisma` is declared as a devDependency.
# It still lands in this install, because @prisma/client declares `prisma` as an
# OPTIONAL PEER dependency and npm auto-installs optional peers even with --omit=dev.
# The guard below fails the build loudly if a future npm stops doing that, instead of
# letting every container start silently re-download the CLI from the registry.
RUN npm ci --omit=dev && node_modules/.bin/prisma --version

# The generated client. Copied AFTER `npm ci`, which would otherwise have wiped it.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# prisma/ carries schema.prisma and the migrations; migrate deploy reads both at runtime.
COPY prisma ./prisma
COPY src ./src

# tests/, .env, .env.test and .git are never copied here (see .dockerignore), and the
# container runs as the unprivileged `node` user rather than root.
USER node

EXPOSE 3000

# Default only — docker-compose.yml overrides this per service (api: migrations +
# server, worker: worker).
CMD ["node", "src/server.js"]