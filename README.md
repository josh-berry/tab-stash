# Tab Stash

Can't keep all your open tabs straight?  Need to clear your plate, but want to
come back to your tabs later?  Need an easy way to find them again?

![screenshot-final](doc/screenshot-5-restored.png)

Tab Stash is a no-fuss way to save, restore and organize batches of tabs as
bookmarks.  With one click on the Tab Stash icon, you can wipe your browser
window clear of tabs, but rest assured—your tabs are waiting for you in the
"Stashed Tabs" sidebar, organized conveniently into groups.

Because Tab Stash stores all of your tabs as bookmarks, they will even sync to
your other computers or mobile devices (using Firefox Sync, if configured).  You
don't need to keep track of yet another account, and no other cloud service can
see your tabs.

## Features

- Stash all your open tabs in one click (in browser toolbar)
- Stash individual tabs in one click (in address bar)
- Unobtrusive Firefox sidebar which shows you all your stashed tabs
- Restore and delete entire groups of tabs, or individual tabs within a group
- Drag and drop stashed tabs and groups to re-organize them
- Rename tab groups, or keep the automatically-generated names
- Intelligent migration of duplicate tabs to the newest groups (for unnamed
  groups; tabs in named groups are not disturbed)

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
2. Click *Load Temporary Add-on*
3. Browse to the `dist` directory, and select the `manifest.json` file.