.PHONY: dev check test build package smoke

dev:
	EIZHU_DEV_MOCK=1 npm run desktop:dev
check:
	npm run check
	npm run lint
test:
	npm test
build:
	npm run desktop:build
package:
	npm run desktop:package
smoke:
	npm run desktop:smoke
