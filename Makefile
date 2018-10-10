VERSION := $(shell node -e "x=`cat dist/manifest.json`; console.log(x.version)")
COMMIT := $(shell git rev-parse --short HEAD)
FULL_VERSION := $(VERSION)-$(COMMIT)

ifeq ($(VERSION),)
$(error Unable to determine the current version number)
endif

ifeq ($(COMMIT),)
$(error Unable to determine the HEAD commit)
endif

SRCPKG_DIR = tab-stash-src-$(FULL_VERSION)
SRC_PKG = $(SRCPKG_DIR).tar.gz
DIST_PKG = tab-stash-$(FULL_VERSION).zip

# Primary (user-facing) targets
debug: build-dbg
.PHONY: debug

rel: release-tag pkg-webext pkg-source
	make -C $(SRCPKG_DIR) release-tag pkg-webext pkg-source
	[ -z "$$(diff -Nru dist $(SRCPKG_DIR)/dist)" ]
	rm -rf $(SRCPKG_DIR)
	@echo ""
	@echo "Ready for release $(VERSION)!"
	@echo
	@echo "Git tag:         v$(VERSION)"
	@echo "Release package: $(DIST_PKG)"
	@echo "Source package:  $(SRC_PKG)"
	@echo
	@echo "If everything looks good, run \"git push\" and upload to AMO."
	@echo ""
.PHONY: rel



# Intermediate targets.
#
# Rather than calling webpack directly, we invoke npm here so that Windows users
# still have a way to build.
pkg-webext: clean-working-tree build-rel
	cd dist && zip -9rvo ../$(DIST_PKG) `find . -type f -not -name 'test.*'`
.PHONY: pkg-webext

pkg-source: clean-working-tree
	rm -rf $(SRCPKG_DIR) $(SRC_PKG)
	git fetch -f origin
	git clone --depth 1 -b v$(VERSION) . $(SRCPKG_DIR)
	tar -czf $(SRC_PKG) $(SRCPKG_DIR)
.PHONY: pkg-source

build-dbg: node_modules
	npm run build
	npm run test
.PHONY: build-dbg

build-rel: node_modules clean
	npm run build-rel
	npm run test
	./node_modules/.bin/web-ext lint -s dist -i 'test.*'
.PHONY: build-rel

release-tag: clean-working-tree
	[ `git name-rev --tags --name-only HEAD` = "v$(VERSION)" ] || \
	    git tag v$(VERSION) HEAD
.PHONY: release-tag
.NOTPARALLEL: release-tag

clean-working-tree:
	[ -z "$$(git status --porcelain)" ] # Working tree must be clean.
.PHONY: clean-working-tree
.NOTPARALLEL: clean-working-tree

node_modules: package.json package-lock.json
	npm install
	touch node_modules

# Cleanup targets
distclean: clean
	rm -rf node_modules $(SRCPKG_DIR) $(SRC_PKG) $(DIST_PKG)
.PHONY: distclean

clean:
	rm -f dist/*.js
	find dist -type f -name .DS_Store |xargs rm
.PHONY: clean
