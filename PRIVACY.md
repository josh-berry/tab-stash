# Tab Stash Privacy Policy

Tab Stash is designed to keep your data on your computer. This document
describes what data the extension stores, where it is stored, and how you can
remove it.

## Summary

- Tab Stash does **not** send any data to a server operated by the developer.
- Tab Stash does **not** contain any analytics, tracking, telemetry, or
  advertising.
- All data is stored locally in your browser profile, using standard browser
  extension storage mechanisms.

## What data is stored

Tab Stash stores the following categories of data:

1. **Your stashed tabs.** When you stash tabs, Tab Stash saves their URLs and
   titles as ordinary browser bookmarks, inside a "Tab Stash" bookmarks folder.
   These are stored in your browser's bookmark store.

2. **Deleted-items history.** When you delete a stashed item, Tab Stash keeps a
   copy of it (URL, title, and structure) in local IndexedDB storage so that you
   can undo the deletion. These items are automatically deleted after 180 days
   by default, and you can change or clear this in the options.

3. **Website favicons.** Tab Stash fetches and caches favicons for the sites in
   your stash. These are stored in local IndexedDB storage so the UI can render
   them without re-fetching them from the network.

4. **Settings.** Your preferences (for example, whether the toolbar button
   stashes all tabs or just the active one) are stored in `chrome.storage.sync`
   so they follow your browser profile, and in `chrome.storage.local`.

## Where data is stored

- **Bookmarks** are stored by the browser itself in your profile's bookmark
  store.
- **Favicons, deleted items, and metadata** are stored in IndexedDB databases
  owned by the extension, within your browser profile.
- **Settings** are stored using the browser's extension storage area
  (`chrome.storage`).

## Browser sync

Because your stashed tabs are stored as ordinary bookmarks, they will sync to
your other devices **only if** you have browser sync (for example, Chrome sync)
enabled. Tab Stash does not provide its own sync service, and it does not
control or access your sync account.

## Third-party services

Tab Stash does not use any third-party services, servers, or accounts. Favicons
are fetched directly from the websites you have stashed by briefly opening the
page in a background tab and reading its favicon, just as a normal browser
would.

## Data removal

- You can delete your stashed tabs at any time from the Tab Stash interface;
  they are stored as ordinary bookmarks, so you can also delete the "Tab Stash"
  bookmarks folder directly in the browser's bookmark manager.
- Deleted items and favicons are cleared automatically over time, and you can
  clear them immediately by resetting or removing the extension.
- Uninstalling the extension removes all locally stored extension data (settings,
  favicons, and deleted-items history). It does **not** remove the "Tab Stash"
  bookmarks folder, which belongs to your browser's bookmark store; you can
  delete that folder yourself if desired.

## Permissions

Tab Stash requests the following permissions, for the following purposes only:

- `tabs`, `windows`, `tabGroups` — to read and organize your open tabs.
- `bookmarks` — to save and restore your stashed tabs.
- `storage`, `unlimitedStorage` — to store settings and the deleted-items
  history.
- `contextMenus` — to add "Stash Tabs" commands to the context menu.
- `alarms` — to run periodic cleanup of old deleted items.
- `sidePanel` — to show the Tab Stash interface in the Chrome side panel.

## Contact

The source code is available at
<https://github.com/pipolarbear/tab-stash>. If you have questions or
concerns about this policy, please open an issue on that repository.

_This policy applies to the Chrome version of Tab Stash._
