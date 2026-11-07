.DEFAULT_GOAL := help
.PHONY: help install dev server pos backoffice display build start test test-pg typecheck check db-create db-reset backup clean docker-build up down logs

# Everything goes through pnpm (see packageManager in package.json).
# Settings for the API come from .env (copy .env.example). Override on the command line:
#   make test-pg PG_ADMIN_URL=postgres://user:pass@host:5432/postgres
# The backup test needs pg_dump: put it on PATH, or add PG_DUMP_PATH=/path/to/pg_dump to the command.
PG_ADMIN_URL ?= postgres://postgres@localhost:5432/postgres
PG_DB        ?= myshop
PORT         ?= 3000
API_RUN       = SWC_NODE_PROJECT=tsconfig.base.json node -r @swc-node/register apps/server/src/main.ts

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	pnpm install

dev: ## API server in watch mode (:3000, reads .env). Run the web apps with: make pos / backoffice / display
	pnpm nx serve server

server: dev ## Alias of dev

pos: ## POS dev server (:4200, proxies /api to :3000)
	pnpm nx serve pos

backoffice: ## Back office dev server (:4202/admin/)
	pnpm nx serve backoffice

display: ## Customer display dev server (:4201/display/)
	pnpm nx serve customer-display

build: ## Build POS, display and back office into dist/apps/
	pnpm nx run-many -t build

start: ## Run the API server once, without watch (it serves JSON only; web files are served by nginx, see make up)
	PORT=$(PORT) $(API_RUN)

test: ## Run every test (the API suite needs PostgreSQL: TEST_DATABASE_URL, default postgres://postgres@localhost:5432/postgres)
	pnpm nx run-many -t test

test-pg: ## Run the API tests on a real PostgreSQL (each test gets a throwaway database)
	TEST_DATABASE_URL=$(PG_ADMIN_URL) pnpm exec vitest run --root apps/server

typecheck: ## Typecheck every project
	pnpm nx run-many -t typecheck

check: typecheck test build ## Typecheck, test and build (run before committing)

db-create: ## Create the database named PG_DB (default myshop) on the server in PG_ADMIN_URL
	psql "$(PG_ADMIN_URL)" -c "CREATE DATABASE $(PG_DB)"

db-reset: ## DROP and recreate PG_DB: all data in it is lost (asks you to type the name first)
	@printf "Drop database $(PG_DB)? Type its name to confirm: " && read answer && [ "$$answer" = "$(PG_DB)" ]
	psql "$(PG_ADMIN_URL)" -c "DROP DATABASE IF EXISTS $(PG_DB) WITH (FORCE)" -c "CREATE DATABASE $(PG_DB)"

backup: ## Dump PG_DB with pg_dump into .data/backups (the API also backs up daily at 03:00)
	mkdir -p .data/backups
	pg_dump --format=custom --file=.data/backups/myshop-$$(date +%Y%m%d-%H%M%S).dump "$(PG_ADMIN_URL:%/postgres=%/$(PG_DB))"

docker-build: ## Build the two Docker images (server and web)
	docker build --target server -t my-shop-server:latest .
	docker build --target web -t my-shop-web:latest .

up: ## Start the shop in Docker (PostgreSQL + server + nginx); needs .env with POSTGRES_PASSWORD and CODE_SECRET
	docker compose up -d --build

down: ## Stop the Docker stack (data volumes are kept)
	docker compose down

logs: ## Follow the server logs in Docker
	docker compose logs -f server

clean: ## Remove build output and caches (keeps .data and .env)
	rm -rf dist .nx coverage
