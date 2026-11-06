# syntax=docker/dockerfile:1.7
#
# Two images from one file:
#   server  the API (NestJS), JSON under /api, talks to PostgreSQL
#   web     nginx serving the POS (/), customer display (/display/) and back office (/admin/), and proxying /api to the server
# Build:  docker build --target server -t my-shop-server .     docker build --target web -t my-shop-web .
# Normally you just run:  docker compose up -d --build
# Debian (not Alpine) for the server because @swc/core ships glibc binaries.

ARG NODE_VERSION=22
ARG PNPM_VERSION=12.16.1
ARG PG_CLIENT_MAJOR=17

# ---------- dependencies ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build the three front ends ----------
FROM deps AS build-web
COPY nx.json tsconfig.base.json vitest.config.mts ./
COPY apps ./apps
COPY libs ./libs
RUN pnpm nx run-many -t build --projects=pos,customer-display,backoffice

# ---------- web: nginx ----------
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-web /app/dist/apps/pos /usr/share/nginx/html
COPY --from=build-web /app/dist/apps/customer-display /usr/share/nginx/html/display
COPY --from=build-web /app/dist/apps/backoffice /usr/share/nginx/html/admin
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

# ---------- server: the API ----------
FROM node:${NODE_VERSION}-bookworm-slim AS server
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

# The server runs from source through SWC (Nest needs the decorator metadata), together with the shared libs.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY apps/server/src ./apps/server/src
COPY libs ./libs

RUN mkdir -p /data/backups && chown -R node:node /data /app
USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/catalog').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "-r", "@swc-node/register", "apps/server/src/main.ts"]
