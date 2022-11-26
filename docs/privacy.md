# Privacy Policy

Tab Stash does not share any of your information with the developers, or with
any third party, except as noted below.

## Bookmarks and Firefox Sync

Tab Stash uses bookmarks to store all your stashed tabs. Your bookmarks are
synced using the Firefox Sync service (if configured), so your stashed tabs will
appear on all computers linked to your Firefox Sync account.

If you wish to stop using Tab Stash entirely, you can still retrieve your
stashed tabs in the "Tab Stash" folder of your bookmarks.

## Extension Permissions

When you first install it, Tab Stash will ask for the following permissions.
Here's why we need each of them:

- **Access browser tabs**: Used to save and restore tabs to the stash.
  (Honestly, we'd all be surprised if an extension with a name like "Tab Stash"
  _didn't_ have this permission.)

- **Access recently closed tabs**: When restoring a stashed tab, Tab Stash will
  look thru recently-closed tabs to see if any of them have matching URLs, and
  restore the closed tab rather than creating a new one. This will restore
  additional state for that tab, such as navigation history.

- **Hide and show browser tabs**: Used to hide stashed tabs instead of closing
  them outright, so they can be restored more quickly later (and preserve useful
  tab state such as navigation history, or that half-written blog post about
  last night's dinner you were in the middle of when your boss walked by...).

- **Read and modify bookmarks**: Used to create and delete bookmarks in the "Tab
  Stash" folder which represent your stashed tabs.

- **Read and modify browser settings**: Read-only; used to determine the new-tab
  and Home pages, so Tab Stash can tell if you're looking at a new tab, and
  automatically close it if it's not needed. Tab Stash does not modify your
  browser settings. (Although, if we _did_, we'd probably change your homepage
  to be a picture of a kitten. Because who doesn't like kittens?)

- **Store client-side data**: Tab Stash stores your preferences (such as whether
  to open the stash in the sidebar or a new tab) in the browser's local and
  synced storage.

- **Store unlimited amount of client-side data**: Tab Stash keeps a cache of
  website icons on your local computer, so they do not have to be fetched from
  the Internet (which can be a very slow process, depending on the website). To
  accommodate users whose stashes may grow very large, we ask to store lots of
  data so the cache can hold all the icons. Icons are removed from the cache
  automatically once they're no longer needed.

- **Containers (contextual identities)** and **Cookies**: If you use Firefox's
  containers feature, these permissions are used to identify which container
  each tab belongs to and show an indicator in the Tab Stash UI.

- **Menus**: Used to provide additional options for Tab Stash in the right-click
  menu of a page and the tab bar.
