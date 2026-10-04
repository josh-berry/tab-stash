# Usage Tips

_Find more usage tips and troubleshooting info, or add your own tips, on the
[Tab Stash wiki][wiki]._

[wiki]: https://github.com/pipolarbear/tab-stash/wiki

## Easy Access to the Side Panel

For easy access to the "Tab Stash" side panel, we recommend you place Chrome's
"Side panel" button in your toolbar. If it's not already there, you can do this
by following these steps:

1. Right-click on the Chrome toolbar (anywhere outside the address bar).
2. Click "Customize toolbar..." from the popup menu.
3. Find the icon labeled "Side panel", and drag it to your toolbar. (If you
   don't see it, it's probably already in your toolbar somewhere.)

If you would prefer not to do this, you can always load the list of stashed tabs
by right-clicking anywhere on the page, selecting "Tab Stash" from the popup
menu, and choosing "Show Stashed Tabs".

## Make Tab Stash Your Homepage

If you would prefer not to use the side panel, or even if you just want easy
access to the full-browser view of your stashed tabs, you can make Tab Stash
your homepage.

1. Right-click the Tab Stash icon in the toolbar, and choose "Show Stashed Tabs
   in a Tab".
2. Right-click in the address bar and select "Copy".
3. Click the Chrome menu (far right side of the toolbar), then "Settings".
4. In the "On startup" section, select "Open a specific page or set of pages".
5. Click "Add a new page" and paste the copied URL into the URL box.

You can now open the stash any time you like by clicking the "Home" button in
your Chrome toolbar.

## Keyboard Shortcuts

You can customize these shortcuts---[here's how][wiki-shortcuts].

[wiki-shortcuts]: https://github.com/pipolarbear/tab-stash/wiki/Changing-Keyboard-Shortcuts

On **Mac**:

- Show stashed tabs in side panel: _Ctrl+Shift+S_
- Stash all (or selected) open tabs: _Ctrl+Shift+T_
- Stash the active tab: _Ctrl+Shift+W_

On **Windows**, **Linux** and other platforms:

- Show stashed tabs in side panel: _Ctrl+Shift+S_
- Stash all (or selected) open tabs: _Ctrl+Shift+T_
- Stash the active tab: _Ctrl+Shift+W_

**NOTE:** The "_Stash all ..._" keyboard shortcuts described above will stash
all tabs if only one tab is selected. But if you have selected multiple tabs in
the browser tab bar using Shift+Click or Cmd/Ctrl+Click, then only the selected
tabs will be stashed.

## Stashing Only Selected Tabs

If you get distracted and wind up with a bunch of tabs mixed together in your
window for different tasks, you can select only those tabs applicable to a
particular task and stash them, leaving the remaining tabs open.

Just Shift-click (or Ctrl/Cmd-click) in the browser tab bar to select multiple
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

1. Tab Stash comes with import/export for a variety of formats---in the Tab
   Stash UI, click the menu icon to the left of the search box and choose
   "Export...".
2. Use the browser's bookmark manager to directly access your bookmarks. You can
   do this even if Tab Stash is not working or has been uninstalled. To access
   your bookmarks in Chrome, click the Chrome menu and choose _Bookmarks >
   Bookmark manager_. Tab Stash places bookmarks for all saved tabs under
   _Other Bookmarks > Tab Stash_.

You can find detailed instructions for exporting your stashed tabs
[on the wiki][export].

[export]: https://github.com/pipolarbear/tab-stash/wiki/Exporting-Your-Stash
