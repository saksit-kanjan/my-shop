.DEFAULT_GOAL := help
.PHONY: help install dev api pos backoffice display build start test test-pg typecheck check db-create db-reset backup clean

# Settings for the API come from .env (copy .env.example). Override on the command line:
#   make test-pg PG_ADMIN_URL=postgres://user:pass@host:5432/postgres
# The backup test needs pg_dump: put it on PATH, or add PG_DUMP_PATH=/path/to/pg_dump to the command.
PG_ADMIN_URL ?= postgres://postgres@localhost:5432/postgres
PG_DB        ?= myshop
PORT         ?= 3000
API_RUN       = npx tsx --env-file-if-exists=.env --tsconfig apps/api/tsconfig.app.json apps/api/src/main.ts

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	npm install

dev: ## API in watch mode (:3000, reads .env)
	npx nx serve api

api: dev ## Alias of dev

pos: ## POS dev server (:4200, proxies /api to :3000)
	npx nx serve pos

backoffice: ## Back office dev server (:4202/admin/)
	npx nx serve backoffice

display: ## Customer display dev server (:4201/display/)
	npx nx serve customer-display

build: ## Build POS, display and back office into dist/
	npx nx run-many -t build

start: build ## Build, then run the shop server: API, POS, display and back office on one port
	PORT=$(PORT) $(API_RUN)

test: ## Run every test (the API suite runs on embedded PGlite)
	npx nx run-many -t test

test-pg: ## Run the API tests on a real PostgreSQL (each test gets a throwaway database)
	TEST_DATABASE_URL=$(PG_ADMIN_URL) npx vitest run --root apps/api

typecheck: ## Typecheck every project
	npx nx run-many -t typecheck

check: typecheck test build ## Typecheck, test and build (run before committing)

db-create: ## Create the database named PG_DB (default myshop) on the server in PG_ADMIN_URL
	psql "$(PG_ADMIN_URL)" -c "CREATE DATABASE $(PG_DB)"

db-reset: ## DROP and recreate PG_DB: all data in it is lost (asks you to type the name first)
	@printf "Drop database $(PG_DB)? Type its name to confirm: " && read answer && [ "$$answer" = "$(PG_DB)" ]
	psql "$(PG_ADMIN_URL)" -c "DROP DATABASE IF EXISTS $(PG_DB) WITH (FORCE)" -c "CREATE DATABASE $(PG_DB)"

backup: ## Dump PG_DB with pg_dump into .data/backups (the API also backs up daily at 03:00)
	mkdir -p .data/backups
	pg_dump --format=custom --file=.data/backups/myshop-$$(date +%Y%m%d-%H%M%S).dump "$(PG_ADMIN_URL:%/postgres=%/$(PG_DB))"

clean: ## Remove build output and caches (keeps .data and .env)
	rm -rf dist .nx coverage
