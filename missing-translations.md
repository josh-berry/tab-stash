# Missing translations audit — raw English in the UI

Audit date: 2026-09-12. Scope: all `.vue` templates, all non-test `src/**/*.ts`, the six
page HTML shells, and `assets/manifest.json`. Method: full reads of every Vue file plus
grep-and-windowed-verification of the TypeScript layer; every finding below was verified
against the actual code.

**Status (2026-09-12): all actionable items below have been fixed in the working tree
(uncommitted).** New keys were added to `assets/_locales/en/messages.json`; the same keys
were added to `assets/_locales/ru/messages.json` with English placeholder text pending
translation. Two behavioral notes: the `folder.vue` move-selection tooltips now use true
plural forms (`item`/`items` instead of `item(s)`), and the test harness gained
`src/mock/browser/i18n.ts`, which answers `browser.i18n.getMessage()` from the English
catalog so unit tests assert against real strings.

**Excluded per agreement:** pure brand-name occurrences ("Tab Stash"), the `STASH_ROOT`
constant (`src/model/bookmarks.ts:95`), the crash-page fallbacks and `[Crash]` issue-title
prefix (`src/components/oops-notification.vue`), all of `src/whats-new/` (changelog stays
English), and — per the original brief — internal logs and error messages, including ones
that reach users via the crash handler. `assets/manifest.json` is fully localized via
`__MSG_*` and needed no changes.

Process notes for fixing:

- New keys must be added to **both** `assets/_locales/en/messages.json` and
  `assets/_locales/ru/messages.json`, or `make check-i18n` fails ("Missing locales for
  key"). Pluralized strings need all plural categories for each locale.
- `check-i18n.js` also fails on defined-but-unused keys, so add each key only alongside
  its first call site.
- Verify with `make check` (types + tests + style + i18n).

## 1. `src/index.ts` — context menus, tab title, toolbar tooltip (16 strings)

Context-menu labels fed to `browser.contextMenus.create()` in the three `menu()` calls
(`src/index.ts:106–156`). Each string below appears in one or more of the menus; first
occurrence line shown.

| Line                | String                          | Reusable key?                                                    |
| ------------------- | ------------------------------- | ---------------------------------------------------------------- |
| 103                 | `Show Stashed Tabs in a Tab`    | no (near-miss: `showStashedTabsInTabTitle`, different case/text) |
| 104                 | `Show Stashed Tabs`             | no                                                               |
| 112 (also 134, 149) | `Show Stashed Tabs in Sidebar`  | no                                                               |
| 115 (also 137)      | `Stash Tabs`                    | no                                                               |
| 116 (also 138)      | `Stash Pinned Tabs`             | no                                                               |
| 117 (also 152)      | `Stash This Tab`                | yes — `stashThisTab` (identical text, line 9 of the catalog)     |
| 118 (also 153)      | `Stash This Tab to a New Group` | no                                                               |
| 120 (also 139)      | `Copy Tabs to Stash`            | no                                                               |
| 121 (also 154)      | `Copy This Tab to Stash`        | no                                                               |
| 123                 | `Options...`                    | yes — `optionsMenu` (line 213)                                   |

Tab title set when opening the setup page (visible in the browser tab strip):

| Line | String              | Notes                                                                          |
| ---- | ------------------- | ------------------------------------------------------------------------------ |
| 301  | `Tab Stash - Setup` | mixed brand + functional text; the "Setup" half is what a translator would see |

Toolbar-icon tooltip via `browserAction.setTitle`, from `getTitle()` at lines 400–410:

| Line | String                         | Reusable key?                               |
| ---- | ------------------------------ | ------------------------------------------- |
| 403  | `Stash all (or selected) tabs` | yes — `stashAllTabs` (identical, line 24)   |
| 405  | `Stash this tab`               | yes — `stashThisTab`                        |
| 407  | `Show stashed tabs`            | no (near-miss: `showStashedTabsInTabTitle`) |
| 409  | `Set up Tab Stash`             | no                                          |

## 2. Static HTML `<title>`s (page scripts can set these at runtime)

HTML pages can't use `__MSG_` substitution, so each needs a one-line
`document.title = $t("...")` in its entry script (or be accepted as English).

| File                       | Title                             | Notes                                                                                                            |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/deleted-items.html:3` | `Deleted Items &mdash; Tab Stash` | contains brand, but not purely branding                                                                          |
| `src/options.html:4`       | `Tab Stash: Options`              | contains brand, but not purely branding                                                                          |
| `src/restore.html:4`       | `Restore Privileged Tab`          | already overridden at runtime when a `url` param is present (`src/restore/index.ts:10`)                          |
| `src/setup.html:4`         | `Welcome to Tab Stash!`           | a `welcomeTitle` key with this exact text already exists (used for the page `<h1>`, just not the document title) |

(`src/stash-list.html`'s "Tab Stash" and `src/whats-new.html`'s title are excluded per
above. Note for completeness: the whats-new page's `<h1>` is already localized via
`whatsNewTitle`, so its English `<title>` is the one chrome inconsistency on that page.)

## 3. `src/stash-list/`

| Location            | String                                                                                       | Shown as                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `folder.vue:181`    | `` `Move ${selectedCount} selected item(s) to this group (hold ${altKey} to copy)` ``        | hover tooltip on the "move selection into this group" button                                                                                           |
| `folder.vue:186`    | `` `Move ${selectedCount} selected item(s) to a new child group (hold ${altKey} to copy)` `` | hover tooltip on the "move selection into a new child group" button                                                                                    |
| `window.vue:454`    | `Untitled`                                                                                   | title of a newly created tab group (browser group UI + this extension's group row)                                                                     |
| `tab-group.vue:278` | `` `${n} tab${n === 1 ? "" : "s"}` `` (in the group-row tooltip)                             | hand-rolled pluralization; the catalog already has `tab`/`tab_dative` plurals used via `$ts()` right next door in `index.vue`'s `search_placeholder()` |

The `folder.vue` tooltips are the clearest miss: `holdShiftMessage()` just above them
(`folder.vue:542–552`) shows the established `$t(...)` pattern for "hold \<key\> to …"
messages, and the catalog has sibling keys like `stashAllToGroupTooltip`.

Borderline (your call, likely skip): `index.vue:270` builds the search placeholder with a
literal `+` loading suffix ("12+ groups" while counts load). It's a symbol, not a word.

## 4. Model layer (`.ts` strings that reach the UI)

| Location                     | String                                                                                                                                                | Shown as                                                                                                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model/index.ts:1004`        | `Untitled`                                                                                                                                            | default tab-group title in `putItemsInNewTabGroup()`, applied via `tabGroups.update`; same literal as `window.vue:454` (the UI duplicate) — one key can cover both                                                                               |
| `model/index.ts:1178`        | `Untitled`                                                                                                                                            | subtitle fallback in `createTreeInWindow()` when stashing a group with subgroups; becomes a browser tab-group title                                                                                                                              |
| `model/index.ts:1377`        | `<no title>`                                                                                                                                          | title stored for a deleted bookmark; rendered verbatim in the Trash UI (`deleted-items/item.vue:31`) and its tooltip                                                                                                                             |
| `model/bookmarks.ts:843–847` | `You have multiple "<stash_root_name>" bookmark folders, and Tab Stash isn't sure which one to use. Click here to find out how to resolve the issue.` | set into `stash_root_warning.text`, rendered at `stash-list/index.vue:36`; every sibling `<Notification>` in that template uses `$t(...)`. Needs a `$1` placeholder for the folder name; the "click here" is an action on the whole notification |

## 5. `src/components/`

| Location                    | String                                                                             | Shown as                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `search-input.vue:10`       | `'Search'` (in `ariaLabel ?? 'Search'`)                                            | screen-reader label fallback when the caller passes no `ariaLabel` prop (some callers do pass one) |
| `search-input.vue:20`       | `Clear Search`                                                                     | `aria-label` on the search clear (×) button                                                        |
| `search-input.vue:21`       | `Clear search`                                                                     | `title` tooltip on the same button (note the different capitalization between the two)             |
| `item-icon.vue:27`          | `'Deselect'` / `'Select'` (ternary)                                                | `title` tooltip on selectable item icons                                                           |
| `notification.vue:13`       | `Dismiss notification`                                                             | `title` tooltip on every notification's dismiss (×) control                                        |
| `confirm-dialog.vue:10`     | `If you change your mind, you can turn this confirmation on again in the options.` | `title` tooltip on the "ask next time" checkbox label                                              |
| `confirm-dialog.vue:13`     | `Ask me again next time`                                                           | the checkbox label itself                                                                          |
| `show-filtered-item.vue:14` | `'Showing'` / `'Hiding'` (ternary)                                                 | `aria-label` on the filtered-items toggle icon                                                     |

None of these have existing catalog keys (checked for `Select`, `Deselect`, `Search`,
`Clear`, `Dismiss`, `Reset`, `Showing`, `Hiding`, `Ask me…`).

## 6. Options + import task

| Location                      | String                      | Shown as                                                                                                                                                                        |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options/feature-flag.vue:21` | `Reset`                     | button label in the `FeatureFlag` component. Caveat: the component is registered in `options/index.vue` but not rendered anywhere today, so this is unreachable until it's used |
| `tasks/import.ts:197`         | `Importing tabs...`         | status line in the import progress dialog (`ProgressDialog` → `progress-item.vue:7`)                                                                                            |
| `tasks/import.ts:227`         | `Creating stash folders...` | child-task status in the same dialog                                                                                                                                            |
| `tasks/import.ts:275`         | `Updating bookmarks...`     | child-task status in the same dialog                                                                                                                                            |
| `tasks/siteinfo.ts:43`        | `Fetching site info...`     | child-task status in the same dialog (invoked from `import.ts:265`)                                                                                                             |

The established pattern for these is already localized — `stash-list/index.vue:511,519`
does `tm.status = $t("fetchingIconsDomain")` — and `$t` is importable in `.ts` via
`src/util/index.ts`.

## Tally

- 16 in `src/index.ts` (10 menu labels × up to 3 menus, 1 tab title, 4 tooltips)
- 4 HTML page titles
- 4 in `src/stash-list/` (+ 1 borderline symbol)
- 4 in the model layer
- 9 across `src/components/`
- 5 in options/import

≈ 42 strings, of which 4 can reuse existing catalog keys (`stashThisTab` ×2,
`stashAllTabs`, `optionsMenu`).

## Excluded (for the record)

- Pure branding: `src/index.ts:191` (`"Tab Stash"` tab title), `src/model/index.ts:669`
  (transient import/restore tab title), `src/stash-list/index.vue:126` (footer
  `Tab Stash {{ my_version }} —`), `src/stash-list.html` (`<title>Tab Stash</title>`).
- `STASH_ROOT = "Tab Stash"` (`src/model/bookmarks.ts:95`) — intentionally non-translatable.
- `src/components/oops-notification.vue:82,89,96` (`<Unknown Browser>` / `<Unknown
Platform>` / `<Unknown Extension>`) and `:143` (`[Crash] ` issue-title prefix).
- All of `src/whats-new/` — including its unlocalized chrome (`version.vue:10` "Version"
  prefix, `item.vue` verb labels + `pr#` link text, `index.vue:987` "Initial experimental
  release") and the whole changelog.
- `src/whats-new.html` `<title>` (see note in section 2).

## Clean files (scanned, nothing found)

`src/model/`: tabs.ts, options.ts, deleted-items.ts, favicons.ts, containers.ts,
browser-settings.ts, bookmark-metadata.ts, tree.ts, tree-selection.ts, tree-filter.ts.
`src/datastore/`: all files. `src/util/`: all files (progress.ts's prose is inside its
doc-comment example; oops.ts out of scope). `src/tasks/export/`: all files except
`helpers.ts:36`, which had one more `"Untitled"` fallback (in export headings) that this
audit's first pass missed. `src/components/`: dnd.ts, dnd-directives.ts, and every `.vue`
except those listed above.
Vue files clean: setup/index.vue, restore/index.vue, deleted-items/index.vue + item.vue,
tasks/import.vue, tasks/export.vue, options/index.vue, and stash-list's tab.vue,
bookmark.vue, folder-list.vue, selection-menu.vue, select-folder.vue.
