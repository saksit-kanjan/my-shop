# syntax=docker/dockerfile:1.7
#
# My Shop: one image that serves the API, the POS (/), the customer display (/display/) and the back office (/admin/).
# Debian (not Alpine) because @swc/core ships glibc binaries. Build:  docker build -t my-shop .

ARG NODE_VERSION=22
ARG PNPM_VERSION=12.16.1
ARG PG_CLIENT_MAJOR=17

# ---------- 1. dependencies ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- 2. build the three front ends ----------
FROM deps AS build
COPY nx.json tsconfig.base.json vitest.config.mts ./
COPY apps ./apps
COPY libs ./libs
RUN pnpm nx run-many -t build --projects=pos,customer-display,backoffice

# ---------- 3. runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG PG_CLIENT_MAJOR
# pg_dump of the same major as the database, for the daily backup. Debian's own client is older and refuses a newer server.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-${PG_CLIENT_MAJOR} \
 && apt-get purge -y --auto-remove curl gnupg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    BACKUP_DIR=/data/backups \
    PG_DUMP_PATH=/usr/lib/postgresql/${PG_CLIENT_MAJOR}/bin/pg_dump \
    SWC_NODE_PROJECT=tsconfig.base.json

# The API runs from source through SWC (it needs the decorator metadata), together with the shared libs.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY apps/api/src ./apps/api/src
COPY libs ./libs
COPY --from=build /app/dist ./dist

RUN mkdir -p /data/backups && chown -R node:node /data /app
USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/catalog').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "-r", "@swc-node/register", "apps/api/src/main.ts"]
