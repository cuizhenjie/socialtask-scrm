COMPOSE=docker compose --env-file infra/.env -f infra/compose.yaml
.PHONY: up down logs build test-java test-web test-domain
up:
	$(COMPOSE) up -d --build
logs:
	$(COMPOSE) logs -f --tail=150
down:
	$(COMPOSE) down
build:
	$(COMPOSE) build
test-domain:
	./scripts/check-domain.sh
test-java:
	cd services/api && mvn test
test-web:
	cd apps/web && npm run typecheck && npm run build
