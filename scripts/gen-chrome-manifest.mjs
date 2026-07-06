#!/usr/bin/env node
// Generates a Manifest V3 manifest for Chrome/Chromium from the Firefox
// manifest (assets/manifest.json), so that name/version/description/icons
// have a single source of truth.
//
// Usage: node scripts/gen-chrome-manifest.mjs [path-to-firefox-manifest]
// Writes the Chrome manifest to stdout.

import * as fs from "fs";
import * as path from "path";
import * as url from "url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DEFAULT_SRC = path.join(HERE, "..", "assets", "manifest.json");

// Firefox-only permissions that Chrome rejects, and permissions that are only
// used to support Firefox-only features (cookies is only used for container
// tabs, i.e. contextualIdentities).
const FIREFOX_ONLY_PERMISSIONS = new Set([
  "tabHide",
  "browserSettings",
  "contextualIdentities",
  "cookies",
]);

export function generateChromeManifest(ff) {
  return {
    manifest_version: 3,
    name: ff.name,
    version: ff.version,
    description: ff.description,
    homepage_url: ff.homepage_url,

    // action.openPopup() is generally available starting in Chrome 127; the
    // background page relies on it for the "show popup" command.
    minimum_chrome_version: "127",

    icons: ff.icons,

    permissions: [
      ...ff.permissions.filter(p => !FIREFOX_ONLY_PERMISSIONS.has(p)),
      // Used in place of long-lived setTimeout()s, which don't survive
      // service-worker suspension.
      "alarms",
    ],

    background: {
      service_worker: "index.js",
      type: "module",
    },

    action: {
      default_title: ff.browser_action.default_title,
      // Chrome doesn't support theme_icons; use the theme-neutral icons.
      default_icon: {
        16: "icons/logo-16.png",
        32: "icons/logo-32.png",
        64: "icons/logo-64.png",
      },
    },

    options_ui: {
      page: ff.options_ui.page,
      // Chrome has no Firefox-style add-ons-manager options panel.
      open_in_tab: true,
    },

    commands: {
      _execute_action: {
        suggested_key: {
          default: "Alt+Shift+T",
          mac: "MacCtrl+Shift+T",
        },
      },
    },
  };
}

/* c8 ignore start -- CLI entry point */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)
) {
  const src = process.argv[2] ?? DEFAULT_SRC;
  const ff = JSON.parse(fs.readFileSync(src, "utf-8"));
  process.stdout.write(
    JSON.stringify(generateChromeManifest(ff), null, 2) + "\n",
  );
}
/* c8 ignore stop */
