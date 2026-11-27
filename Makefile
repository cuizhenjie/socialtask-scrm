COMPOSE=docker compose --env-file infra/.env -f infra/compose.yaml
.PHONY: up down logs build health backup test-java test-web test-domain
up:
	$(COMPOSE) up -d --build
logs:
	$(COMPOSE) logs -f --tail=150
down:
	$(COMPOSE) down
build:
	$(COMPOSE) build
health:
	curl -fsS http://127.0.0.1:8080/actuator/health && echo ""
	curl -fsS http://127.0.0.1:8080/api/v1/health && echo ""
backup:
	bash scripts/backup-db.sh
test-domain:
	./scripts/check-domain.sh && ./scripts/check-features.sh && ./scripts/check-wecom-oauth-policy.sh && python3 ./scripts/check-contract.py
test-java:
	cd services/api && mvn -B -ntp test
test-web:
	cd apps/web && npm run typecheck && npm run build
