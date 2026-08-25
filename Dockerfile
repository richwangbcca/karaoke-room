# Build stage: needs devDependencies (tsc, vite) that the runtime image does not.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

# Copy manifests first so a lockfile-only change is the thing that busts the cache, not source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile

COPY . .
# client -> client/dist (static bundle), server -> server/dist (compiled JS)
RUN pnpm --filter client build && pnpm --filter server build

# Runtime stage: production dependencies plus the two dist folders, no toolchain.
FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --prod

# The server resolves the client bundle at ../../client/dist relative to server/dist, so this
# layout has to match the repo's.
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# Match fly.toml's internal_port. The app reads PORT and falls back to 3000.
ENV PORT=8080
EXPOSE 8080

# Run as the unprivileged user the base image already provides.
USER node
CMD ["node", "server/dist/index.js"]
