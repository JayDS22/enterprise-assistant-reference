.PHONY: dev install seed eval test typecheck k6 deploy

install:
	pnpm install

dev:
	pnpm dev

seed:
	pnpm seed

eval:
	pnpm eval

test:
	pnpm test

typecheck:
	pnpm typecheck

k6:
	pnpm k6

deploy:
	flyctl deploy --remote-only --config infra/fly/fly.toml
