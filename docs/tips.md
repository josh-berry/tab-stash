# Usage Tips

_Find more usage tips and troubleshooting info, or add your own tips, on the
[Tab Stash wiki][wiki]._

[wiki]: https://github.com/josh-berry/tab-stash/wiki

## Easy Access to the Sidebar

For easy access to the "Tab Stash" sidebar, we recommend you place Firefox's
"Sidebars" button in your toolbar. If it's not already there, you can do this
by following these steps:

1. Right-click on the Firefox toolbar (anywhere outside the address bar).
2. Click "_Customize..._" from the popup menu.
3. Find the icon labeled "_Sidebars_", and drag it to your toolbar. (If you
   don't see it, it's probably already in your toolbar somewhere.)

If you would prefer not to do this, you can always load the list of stashed tabs
by right-clicking anywhere on the page, selecting "_Tab Stash_" from the popup
menu, and choosing "_Show Stashed Tabs_".

## Make Tab Stash Your Homepage

If you would prefer not to use the sidebar, or even if you just want easy access
to the full-browser view of your stashed tabs, you can make Tab Stash your
homepage.

1. Right-click the Tab Stash icon in the toolbar, and choose "Show Stashed Tabs
   in a Tab".
2. Right-click in the address bar and select "Copy".
3. Click the Firefox menu (far right side of the toolbar), then "Preferences".
4. In the "Preferences" tab, click "Home".
5. Next to "Homepage and new windows", click the drop-down and select "Custom
   URLs...".
6. Paste the copied URL from the address bar into the Custom URL box.

You can now open the stash any time you like by clicking the "Home" button in
your Firefox toolbar.

## Keyboard Shortcuts

On **Mac**:

- Show stashed tabs in sidebar: _Ctrl+Shift+S_
- Stash all (or selected) open tabs: _Ctrl+Shift+T_
- Stash the active tab: _Ctrl+Shift+W_

On **Windows**, **Linux** and other platforms:

- Show stashed tabs in sidebar: _Ctrl+Alt+S_
- Stash all (or selected) open tabs: _Ctrl+Alt+T_
- Stash the active tab: _Ctrl+Alt+W_

**NOTE:** The "_Stash all ..._" keyboard shortcuts described above will stash
all tabs if only one tab is selected. But if you have selected multiple tabs
using Shift+Click or Cmd/Ctrl+Click, then only the selected tabs will be
stashed.

## Stashing Only Selected Tabs

In Firefox 64 and newer, if you get distracted and wind up with a bunch of tabs
mixed together in your window for different tasks, you can select only those
tabs applicable to a particular task and stash them, leaving the remaining tabs
open.

Just Shift-click (or Ctrl/Cmd-click) in the Firefox tab bar to select multiple
tabs at once, and click any "Stash all..." button (in the browser toolbar or
stash view). When Tab Stash sees that you have multiple tabs selected, it will
stash only the selected tabs.

You can still stash individual tabs using the "Stash this tab" buttons in the
location bar or stash view---these buttons ignore multi-selection and stash only
the currently-visible tab.

## Exporting Tabs from Tab Stash

Tab Stash stores all saved tabs as bookmarks. However, restoring a tab and
opening a bookmark are different---when restoring a tab through the _Tab Stash_
interface, Tab Stash will first search for a matching hidden or recently-closed
tab. If there are no matching tabs, only then will Tab Stash open a new tab.

There are two ways to get your saved tabs out of Tab Stash:

1. Tab Stash 2.6 and later comes with import/export for a variety of
   formats---in the Tab Stash UI, click the menu icon to the left of the search
   box and choose "Export...".
2. Use Firefox or another extension to directly access your bookmarks. You can
   do this even if Tab Stash is not working or has been uninstalled. To access
   your bookmarks in Firefox directly, open the Firefox menu and choose
   _Library > Bookmarks > Show All Bookmarks_. Tab Stash places bookmarks for
   all saved tabs under _Other Bookmarks > Tab Stash_.

You can find detailed instructions for exporting your stashed tabs
[on the wiki][export].

[export]: https://github.com/josh-berry/tab-stash/wiki/Copying-Bookmarks-Out-of-Firefox

## Manually Editing Tab Stash Bookmarks

You may freely delete, move, or edit bookmarks saved by Tab Stash using the
built-in Firefox bookmark editor, or any other bookmarks extension you like.
Tab Stash will notice any manual changes to your bookmarks, and close hidden
tabs associated with bookmarks that are deleted or moved out of the stash.
