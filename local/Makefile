# Local development. Run these in this folder (`cd local`), or from the repo
# root with `make -C local <command>`. LOCAL_SETUP.md explains the setup.

COMPOSE := docker compose
s ?= backend

.DEFAULT_GOAL := help
.PHONY: help doctor up down reset logs ps shell restart

help: ## List the commands
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-8s %s\n", $$1, $$2}'

doctor: ## Check Docker, Docker Compose and free ports
	@./dev.sh doctor

up: ## Build and start everything, then wait until the app answers
	@./dev.sh doctor
	@./dev.sh env
	$(COMPOSE) up --build --detach --remove-orphans
	@./dev.sh wait

down: ## Stop everything and keep the data
	$(COMPOSE) down

reset: ## Delete the database and installed packages, then start again
	$(COMPOSE) down --volumes
	@$(MAKE) --no-print-directory up

logs: ## Follow the logs of every service, or of one: make logs s=backend
	$(COMPOSE) logs --follow $(if $(filter command line,$(origin s)),$(s))

ps: ## Show what is running
	$(COMPOSE) ps --all

shell: ## Open a shell in a service (default: backend): make shell s=frontend
	$(COMPOSE) exec $(s) sh

restart: ## Restart a service (default: backend): make restart s=backend-worker
	$(COMPOSE) restart $(s)
