# Primary (user-facing) targets
debug: build-dbg
.PHONY: debug

pkg: PROVENANCE build-rel
	./node_modules/.bin/web-ext build -o -s dist -a . -v
	tar -czf source.tar.gz $$(git ls-tree -r master --name-only)
.PHONY: pkg



# Intermediate targets.
#
# Rather than calling webpack directly, we invoke npm here so that Windows users
# still have a way to build.
build-dbg: node_modules
	npm run build
.PHONY: build-dbg
build-rel: node_modules clean
	npm run build-rel
	./node_modules/.bin/web-ext lint -s dist
.PHONY: build-rel

node_modules: package.json package-lock.json
	npm install
	touch node_modules

PROVENANCE:
	rm -f PROVENANCE
	[ -z "$$(git status --porcelain)" ] # Repo must be clean
	[ "$$(git name-rev --name-only --refs 'refs/remotes/origin/*' HEAD)" != undefined ] # Upstream must contain the HEAD commit
	git rev-parse HEAD >PROVENANCE
	git remote get-url origin >PROVENANCE
.PHONY: PROVENANCE # not actually phony, but should ALWAYS be regenerated

# Cleanup targets
distclean: clean
	rm -rf node_modules
.PHONY: distclean

clean:
	rm -f dist/*.js
.PHONY: clean
