// Tests for scripts/gen-chrome-manifest.mjs, which generates the Chrome
// (Manifest V3) manifest from the Firefox one.  (The test lives here because
// mocha only looks for tests under src/.)

import {expect} from "chai";

import {generateChromeManifest} from "../scripts/gen-chrome-manifest.mjs";

// A fixture mirroring the shape of assets/manifest.json (the real manifest is
// read at build time; this test only exercises the transformation logic).
const ff = {
  manifest_version: 2,
  name: "Tab Stash",
  version: "3.4",
  description:
    "A no-fuss way to save and restore batches of tabs as bookmarks.",
  homepage_url: "https://josh-berry.github.io/tab-stash/",
  icons: {16: "icons/logo-16.png", 128: "icons/logo-128.png"},
  browser_specific_settings: {gecko: {id: "tab-stash@condordes.net"}},
  permissions: [
    "sessions",
    "tabs",
    "tabHide",
    "bookmarks",
    "contextMenus",
    "browserSettings",
    "storage",
    "unlimitedStorage",
    "contextualIdentities",
    "cookies",
  ],
  content_security_policy: "script-src 'self'; object-src 'self';",
  background: {scripts: ["index.js"]},
  browser_action: {default_title: "Tab Stash", default_icon: {}},
  page_action: {default_title: "Stash this tab"},
  sidebar_action: {default_panel: "stash-list.html?view=sidebar"},
  options_ui: {page: "options.html", browser_style: true},
  commands: {
    _execute_browser_action: {suggested_key: {default: "Ctrl+Alt+T"}},
    _execute_sidebar_action: {suggested_key: {default: "Ctrl+Alt+S"}},
    _execute_page_action: {suggested_key: {default: "Ctrl+Alt+W"}},
  },
};

describe("scripts/gen-chrome-manifest", () => {
  const chrome = generateChromeManifest(ff);

  it("generates a Manifest V3 manifest", () => {
    expect(chrome.manifest_version).to.equal(3);
  });

  it("keeps identity fields in sync with the Firefox manifest", () => {
    expect(chrome.name).to.equal(ff.name);
    expect(chrome.version).to.equal(ff.version);
    expect(chrome.description).to.equal(ff.description);
    expect(chrome.icons).to.deep.equal(ff.icons);
  });

  it("uses a module service worker for the background", () => {
    expect(chrome.background).to.deep.equal({
      service_worker: "index.js",
      type: "module",
    });
  });

  it("omits Firefox-only permissions and requests alarms", () => {
    for (const p of [
      "tabHide",
      "browserSettings",
      "contextualIdentities",
      "cookies",
    ]) {
      expect(chrome.permissions).to.not.include(p);
    }
    expect(chrome.permissions).to.include("alarms");
    for (const p of ["sessions", "tabs", "bookmarks", "contextMenus"]) {
      expect(chrome.permissions).to.include(p);
    }
  });

  it("omits Firefox-only UI entry points", () => {
    expect(chrome.browser_action).to.be.undefined;
    expect(chrome.page_action).to.be.undefined;
    expect(chrome.sidebar_action).to.be.undefined;
    expect(chrome.browser_specific_settings).to.be.undefined;
    expect(chrome.action).to.not.be.undefined;
  });

  it("uses MV3 command names", () => {
    expect(chrome.commands._execute_action).to.not.be.undefined;
    expect(chrome.commands._execute_browser_action).to.be.undefined;
    expect(chrome.commands._execute_sidebar_action).to.be.undefined;
    expect(chrome.commands._execute_page_action).to.be.undefined;
  });

  it("opens the options page in a tab", () => {
    expect(chrome.options_ui.open_in_tab).to.be.true;
  });
});
