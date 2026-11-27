COMPOSE=docker compose --env-file infra/.env -f infra/compose.yaml
.PHONY: up down logs build health test
up:
	$(COMPOSE) up -d --build
logs:
	$(COMPOSE) logs -f --tail=150
down:
	$(COMPOSE) down
build:
	$(COMPOSE) build
health:
	curl -fsS http://127.0.0.1:3000/api/v1/ready
test:
	cd apps/web && npm run typecheck && npm run build
	node --experimental-strip-types scripts/check-login-return.mjs
	node --experimental-strip-types scripts/check-wecom-oauth.mjs
	python3 scripts/check-contract.py
	node scripts/test-next-runtime.mjs
	npm test --prefix plugins/dsh-socialtask
