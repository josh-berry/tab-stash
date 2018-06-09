# Tab Stash

Can't keep all your open tabs straight?  Need to clear your plate, but want to
come back to your tabs later?  Need an easy way to find them again?

Tab Stash is a no-fuss way to save, restore and organize batches of tabs as
bookmarks.  With one click on the Tab Stash icon, you can sweep your browser
window clear of tabs, and save them all into the "Stashed Tabs" sidebar,
organized conveniently into groups.  Then, when it's time to go back to that
research project, just pop open the sidebar and restore the whole group, or restore just that one tab you were interested in.

Because Tab Stash stores your tabs as bookmarks, they will even sync to your
other computers or mobile devices (using Firefox Sync, if configured).  You
don't need to keep track of yet another account, and no other cloud service can
see your tabs.

<img src="doc/screenshot-5-restored.png" alt="Screenshot" width="100%"/>

## Features

- Stash all your open tabs in one click (in browser toolbar)
- Stash individual tabs in one click (in address bar)
- Unobtrusive Firefox sidebar which shows all your stashed tabs
- Restore and delete entire groups of tabs, or individual tabs within a group
- Drag and drop stashed tabs and groups to re-organize them
- Rename tab groups, or keep the automatically-generated names
- Intelligent migration of duplicate tabs to the newest groups (for unnamed
  groups; tabs in named groups are not disturbed)

## Usage Tips

For easy access to the "Stashed Tabs" sidebar, we recommend you place Firefox's
"Sidebars" button in your toolbar.  You can do this by following these steps:

1. Open the Firefox menu (on the right side of the toolbar)
2. Click "*Customize...*"
3. Find the icon labeled "*Sidebars*", and drag it to your toolbar.

If you would prefer not to do this, you can always load the list of stashed tabs
by right-clicking the "*Stash Open Tabs*" icon in your toolbar and selecting
"*Stashed Tabs*".

You can also browse to the "*Tab Stash*" folder in the Firefox bookmarks editor.
However, restoring a tab this way will not restore all the history saved with
that tab (if it is available).

## Privacy

Tab Stash does not share any of your information with the developers, or with
any third party, except as noted below.

### Bookmarks and Firefox Sync

Tab Stash uses bookmarks to store all your stashed tabs.  Your bookmarks are
synced using the Firefox Sync service (if configured), so your stashed tabs will
appear on all computers linked to your Firefox Sync account.

If you wish to stop using Tab Stash entirely, you can still retrieve your
stashed tabs in the "Tab Stash" folder of your bookmarks.

### Site Icons and Google

Like many other extensions, Tab Stash shares the domain names of tabs that you
stash with Google, for the purpose of obtaining the site's icon.  If you are
already logged into Google, Google may be able to identify you using login
cookies sent as part of the request.  However, no other personally-identifying
information is shared, and the full URL of the tab is never disclosed.

## Building Tab Stash
```sh
$ npm i
$ npm run build
```

The result will be in the `dist` directory.  You can load it into your Firefox
by following these steps:

1. Go to `about:debugging`
2. Click "*Load Temporary Add-on*"
3. Browse to the `dist` directory, and select the `manifest.json` file.
