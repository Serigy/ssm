# SSM — Serigy Service Manager
#
#   make help     lists everything below

SHELL       := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

COMPOSE     ?= docker compose
KIND_CLUSTER?= ssm
NAMESPACE   ?= ssm
REGISTRY    ?= ssm
TAG         ?= dev

SERVICES    := gateway identity-svc financial-svc hr-svc legal-svc
WEBAPPS     := shell mfe-financial mfe-hr mfe-legal

# Local runs read secrets from the repo instead of /run/secrets.
export SSM_SECRETS_DIR ?= $(CURDIR)/secrets/local

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS=":.*##"; printf "\n\033[1mSSM — comandos\033[0m\n\n"} \
		/^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[32m%-22s\033[0m %s\n", $$1, $$2 } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)
	@echo

##@ Primeiros passos

.PHONY: preflight
preflight: ## Check that the host has every required tool
	@./scripts/preflight.sh

.PHONY: install-tools
install-tools: ## Install kind, helm and terraform into ~/.local/bin
	@./scripts/install-tools.sh

.PHONY: secrets
secrets: ## Generate secrets/local/ (idempotent; --force to rotate)
	@./scripts/gen-secrets.sh

.PHONY: install
install: ## Install workspace dependencies
	pnpm install

.PHONY: bootstrap
bootstrap: preflight secrets install ## Everything a fresh clone needs
	@echo
	@echo "Pronto. Suba o ambiente com 'make dev'."

##@ Desenvolvimento local (docker compose)

.PHONY: dev
dev: ## Build and start the whole stack
	$(COMPOSE) up -d --build
	@echo
	@$(MAKE) --no-print-directory wait-healthy
	@$(MAKE) --no-print-directory migrate
	@echo
	@echo "  gateway     http://localhost:3000"
	@echo "  swagger     http://localhost:3002/docs  (financeiro)"
	@echo "  rabbitmq    http://localhost:15672"
	@echo "  minio       http://localhost:9001"
	@echo
	@echo "Suba os front-ends com 'make web'."

.PHONY: web
web: ## Run shell + the three remotes with hot reload
	pnpm nx run-many -t serve -p shell mfe-financial mfe-hr mfe-legal --parallel=4

.PHONY: infra
infra: ## Start only the datastores (postgres, mongo, rabbitmq, minio)
	$(COMPOSE) up -d postgres mongo rabbitmq minio minio-init

.PHONY: services services-stop services-status
services: ## Run the five services from dist against the compose datastores
	@./scripts/dev-native.sh start
services-stop: ## Stop the natively-run services
	@./scripts/dev-native.sh stop
services-status: ## Readiness of the natively-run services
	@./scripts/dev-native.sh status

.PHONY: up-native
up-native: infra build services ## Whole stack without building images (fastest inner loop)
	@echo
	@echo "  API      http://localhost:3000/api/v1/status"
	@echo "  Agora rode 'make web' e abra http://localhost:4200"

.PHONY: up down restart logs ps
up: ## Start the stack without rebuilding
	$(COMPOSE) up -d
down: ## Stop the stack, keeping volumes
	$(COMPOSE) down
restart: down up ## Restart the stack
logs: ## Follow logs (S=<service> to filter)
	$(COMPOSE) logs -f --tail=100 $(S)
ps: ## Show container status
	$(COMPOSE) ps

.PHONY: nuke
nuke: ## Stop everything and DELETE the local data volumes
	@read -p "Isso apaga postgres, mongo, rabbitmq e minio locais. Continuar? [s/N] " ok; \
	 [[ "$$ok" == "s" ]] || exit 1
	$(COMPOSE) down -v --remove-orphans

.PHONY: wait-healthy
wait-healthy: ## Block until every container reports healthy
	@echo "Aguardando os serviços ficarem saudáveis..."
	@for i in $$(seq 1 60); do \
	  unhealthy=$$($(COMPOSE) ps --format json 2>/dev/null | grep -c '"Health":"starting"' || true); \
	  if [[ "$$unhealthy" == "0" ]]; then echo "Todos saudáveis."; exit 0; fi; \
	  sleep 2; \
	done; \
	echo "Timeout. Verifique 'make logs'."; exit 1

##@ Banco de dados

.PHONY: migrate
migrate: ## Run migrations for every Postgres-backed service (in the containers)
	@for svc in identity-svc financial-svc hr-svc; do \
	  echo "==> $$svc"; \
	  $(COMPOSE) exec -T $$svc node node_modules/typeorm/cli.js \
	    migration:run -d dist/data-source.js || \
	    echo "  (pulado — o serviço ainda não subiu)"; \
	done

.PHONY: migrate-local
migrate-local: ## Run migrations from the host against the compose databases
	@for svc in identity-svc financial-svc hr-svc; do \
	  case $$svc in \
	    identity-svc)  db=ssm_identity  ;; \
	    financial-svc) db=ssm_financial ;; \
	    hr-svc)        db=ssm_hr        ;; \
	  esac; \
	  echo "==> $$svc -> $$db"; \
	  ( cd apps/$$svc && \
	    POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_DB=$$db \
	    ./node_modules/.bin/typeorm migration:run \
	      -d dist/apps/$$svc/src/database/data-source.js ); \
	done

.PHONY: seed
seed: ## Load the demo dataset (idempotent)
	pnpm tsx tools/seed/seed.ts

.PHONY: psql
psql: ## Open psql (DB=ssm_financial by default)
	$(COMPOSE) exec postgres psql -U ssm -d $(or $(DB),ssm_financial)

.PHONY: mongosh
mongosh: ## Open a mongo shell on the legal database
	$(COMPOSE) exec mongo mongosh -u ssm -p "$$(cat secrets/local/mongo_password)" \
	  --authenticationDatabase admin ssm_legal

##@ Qualidade

.PHONY: lint typecheck test build check
lint: ## Lint every project
	pnpm nx run-many -t lint
typecheck: ## Type-check every project
	pnpm nx run-many -t typecheck
test: ## Run every test suite
	pnpm nx run-many -t test
build: ## Build every project
	pnpm nx run-many -t build
check: lint typecheck test ## Everything CI runs on a pull request

.PHONY: e2e
e2e: ## End-to-end no navegador (exige a stack de pé: infra + services + web)
	pnpm playwright test

.PHONY: e2e-ui
e2e-ui: ## E2E em modo interativo
	pnpm playwright test --ui

.PHONY: web-start web-stop web-status
web-start: ## Sobe os quatro dev servers em segundo plano
	@./scripts/dev-web.sh start
web-stop: ## Derruba os dev servers (mata pela porta, não pelo PID)
	@./scripts/dev-web.sh stop
web-status: ## Estado dos dev servers
	@./scripts/dev-web.sh status

.PHONY: affected
affected: ## Run the checks only for projects touched since main
	pnpm nx affected -t lint,typecheck,test,build

.PHONY: format
format: ## Apply Prettier
	pnpm prettier --write .

##@ Contratos de API

.PHONY: openapi
openapi: ## Regenerate docs/api/*.openapi.json from the services
	pnpm nx run-many -t openapi
	@echo "Especificações atualizadas em docs/api/. Faça commit do diff."

.PHONY: openapi-check
openapi-check: openapi ## Fail if the committed specs are stale
	@git diff --exit-code --stat docs/api/ || \
	  (echo; echo "As especificações OpenAPI estão desatualizadas. Rode 'make openapi' e faça commit."; exit 1)

##@ Segurança

.PHONY: audit
audit: ## Dependency audit
	pnpm audit --audit-level=high

.PHONY: aikido
aikido: ## Run the Aikido CI scan (needs secrets/local/aikido_token)
	@test -s secrets/local/aikido_token || \
	  (echo "secrets/local/aikido_token está vazio. Pegue um token em app.aikido.dev."; exit 1)
	AIKIDO_API_KEY="$$(cat secrets/local/aikido_token)" npx @aikidosec/cli scan --fail-on=high

.PHONY: secrets-check
secrets-check: ## Verify nothing under secrets/ is tracked by git
	@leaked=$$(git ls-files secrets/ | grep -v -E '^secrets/(README.md|.gitignore|example/)' || true); \
	 if [[ -n "$$leaked" ]]; then \
	   echo "SEGREDOS RASTREADOS PELO GIT:"; echo "$$leaked"; exit 1; \
	 fi; \
	 echo "OK — nada sensível rastreado."

##@ Imagens

.PHONY: images
images: ## Build every container image
	@for app in $(SERVICES); do \
	  echo "==> $$app"; \
	  docker build -f docker/service.Dockerfile --build-arg APP=$$app \
	    -t $(REGISTRY)/$$app:$(TAG) . ; \
	done
	@$(MAKE) --no-print-directory web-images

.PHONY: web-images
web-images: ## Build the frontend images with their cluster paths baked in
	docker build -f docker/web.Dockerfile --build-arg APP=shell \
	  --build-arg PUBLIC_PATH=/ \
	  --build-arg REMOTE_FINANCIAL=/financeiro/remoteEntry.js \
	  --build-arg REMOTE_HR=/pessoas/remoteEntry.js \
	  --build-arg REMOTE_LEGAL=/juridico/remoteEntry.js \
	  -t $(REGISTRY)/shell:$(TAG) .
	docker build -f docker/web.Dockerfile --build-arg APP=mfe-financial \
	  --build-arg PUBLIC_PATH=/financeiro/ -t $(REGISTRY)/mfe-financial:$(TAG) .
	docker build -f docker/web.Dockerfile --build-arg APP=mfe-hr \
	  --build-arg PUBLIC_PATH=/pessoas/ -t $(REGISTRY)/mfe-hr:$(TAG) .
	docker build -f docker/web.Dockerfile --build-arg APP=mfe-legal \
	  --build-arg PUBLIC_PATH=/juridico/ -t $(REGISTRY)/mfe-legal:$(TAG) .

##@ Kubernetes (kind)

.PHONY: kind-up
kind-up: ## Create the local kind cluster with an Ingress controller
	@./deploy/kind/create-cluster.sh $(KIND_CLUSTER)

.PHONY: kind-down
kind-down: ## Delete the kind cluster
	kind delete cluster --name $(KIND_CLUSTER)

.PHONY: kind-load
kind-load: images ## Load the local images into kind (no registry needed)
	@for app in $(SERVICES) $(WEBAPPS); do \
	  echo "==> $$app"; \
	  kind load docker-image $(REGISTRY)/$$app:$(TAG) --name $(KIND_CLUSTER); \
	done

.PHONY: k8s-secrets
k8s-secrets: ## Create the cluster Secret from secrets/local/
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	kubectl -n $(NAMESPACE) create secret generic ssm-secrets \
	  --from-file=secrets/local/ --dry-run=client -o yaml | kubectl apply -f -
	@echo "Secret ssm-secrets criado a partir de secrets/local/ — mesmo layout de arquivos."

.PHONY: deploy
deploy: kind-load k8s-secrets ## Install/upgrade the Helm release on kind
	helm upgrade --install ssm deploy/helm/ssm \
	  --namespace $(NAMESPACE) --create-namespace \
	  --values deploy/helm/ssm/values-kind.yaml \
	  --set image.tag=$(TAG) \
	  --wait --timeout 10m
	@echo
	@echo "  http://ssm.localhost"

.PHONY: k8s-status
k8s-status: ## Show what is running in the cluster
	kubectl -n $(NAMESPACE) get pods,svc,ingress

.PHONY: undeploy
undeploy: ## Remove the Helm release
	helm uninstall ssm --namespace $(NAMESPACE) || true

##@ Infraestrutura

.PHONY: tf-init tf-plan tf-apply
tf-init: ## terraform init
	terraform -chdir=deploy/terraform init
tf-plan: ## terraform plan
	terraform -chdir=deploy/terraform plan
tf-apply: ## terraform apply
	terraform -chdir=deploy/terraform apply

.PHONY: ansible-check ansible-apply
ansible-check: ## Ansible dry run against the inventory
	ansible-playbook -i deploy/ansible/inventory/hosts.yml deploy/ansible/site.yml --check --diff
ansible-apply: ## Apply the Ansible playbook
	ansible-playbook -i deploy/ansible/inventory/hosts.yml deploy/ansible/site.yml

##@ Utilidades

.PHONY: token
token: ## Print a development access token. TENANT=<uuid> PERMS=a,b to narrow it
	@pnpm -s tsx tools/seed/mint-token.ts \
	  $(if $(TENANT),--tenant $(TENANT)) $(if $(PERMS),--perms $(PERMS))

.PHONY: check-isolation
check-isolation: ## Prove tenant isolation holds against a running financial-svc
	@echo "Um token de outro cliente não pode enxergar nem tocar estes dados."
	@mine=$$(pnpm -s tsx tools/seed/mint-token.ts); \
	 other=$$(pnpm -s tsx tools/seed/mint-token.ts --tenant 99999999-9999-4999-8999-999999999999); \
	 url=http://localhost:3002/api/financial/v1/invoices; \
	 echo "  tenant legítimo: $$(curl -s -H "Authorization: Bearer $$mine"  $$url | head -c 60)..."; \
	 echo "  outro tenant:    $$(curl -s -H "Authorization: Bearer $$other" $$url)"

.PHONY: graph
graph: ## Open the Nx project graph
	pnpm nx graph
