<template>
<div>
  <header>
    <h1>What's New in Tab Stash</h1>

    <div class="status-text">
      <a href="stash-list.html">&#x2190; Back to Tab Stash</a>
    </div>
  </header>

  <div class="folder-list">

    <Version v="2.4">
      <L issue="24" v="Added">support for stashing tabs which are in Reader
        View.  Due to Firefox security restrictions, there are a couple caveats
        to be aware of:</L>
      <ul>
        <li>The "Stash this tab" icon will not appear in the address bar for
          Reader View pages.  You can instead use the right-click menu to stash
          individual Reader View tabs.</li>
        <li>Tab Stash cannot restore tabs directly to Reader View, so if a tab
          is no longer available (e.g. it was closed and removed from Firefox's
          cache), Tab Stash will restore it to the normal website view.</li>
      </ul>
      <L issue="2" v="Added">a record of which groups are visible and which
        are collapsed.  If you hide a group, we will now remember that, and
        we won't show you its contents again unless you ask (even if you restart
        your browser).</L>
      <L :subtext="`Icons are locally-sourced from websites using only `
                   + `sustainable fetching practices.  Certified 100% `
                   + `inorganic, non-GMO, gluten-free.  Ask your doctor about `
                   + `side effects.`"
         issue="3" v="Improved">your privacy by replacing the Google icon
        service with a local cache of website icons.  Note that <b>some of your
        website icons may go missing</b> until you visit the site and the cache
        can be populated&mdash;this is normal.</L>
      <L issue="25" v="Fixed">an issue causing Tab Stash to mistakenly close a
        tab it had just opened if multiple individual tabs are opened from the
        stash list in quick succession.</L>
    </Version>

    <Version v="2.3.1">
      <L :subtext="`This bug got introduced in 2.3 because, ironically, I made `
         + `some changes to try to catch more issues like this before they `
         + `made it into a release.`"
         v="Fixed">an issue preventing the sidebar from opening after stashing
         tabs when the (default) option "<em>Automatically show your stashed
         tabs in the sidebar</em>" is chosen.  The tabs would get saved
         correctly, but you'd have no idea where they went because the sidebar
         wouldn't open.</L>
    </Version>

    <Version v="2.3">
      <L issue="6" v="Added">the ability to stash multiple selected tabs at once
        in <a href="https://www.mozilla.org/en-US/firefox/64.0/releasenotes/">Firefox 64</a>
        and newer.  Just Ctrl/Cmd- or Shift-click on the tabs you want to
        stash, and then click any
        <img class="inl" src="icons/stash-dark.svg" alt="multi-stash">
        button.</L>
      <L v="Added">the ability to manage collapsed groups in the sidebar.  When
        you hover over a collapsed group, the group's "Stash..." and "Open..."
        buttons will now appear.</L>
      <L v="Improved">the ordering of context-menu items to put more
        commonly-used items first.</L>
      <L :issue="8" v="Fixed">a poor interaction between Tab Stash and Firefox
        Sync that would occasionally cause stashed tabs to get mis-filed so they
        no longer appear in the stash.  To recover any missing tabs, see:</L>
      <L v="Fixed">an issue where the "Close all open tabs" button wasn't
        respecting the "hide" vs. "close" stashed tabs setting.</L>
    </Version>

    <Version v="2.2.1">
      <L subtext="Fun fact: This bug was caused by a single-letter typo."
         v="Fixed">an issue preventing Tab Stash from closing hidden tabs
        associated with bookmarks that were deleted from the stash.</L>
      <L subtext="Fun fact: This bug was caused by the SAME single-letter typo."
         v="Fixed">an issue preventing Tab Stash from unloading old hidden tabs
        correctly.</L>
      <L :subtext="`Yep... this one too. (If you really want to know, a 'T' `
                   + `was capitalized when it should have been lowercase.)`"
         v="Fixed">an issue preventing Tab Stash from automatically deleting
        empty folders in the stash.</L>
      <L :issue="4"
         subtext="This bug was caused by a whole WORD being wrong."
         v="Fixed">an issue where the option to close instead of hide stashed
        tabs wasn't being respected.</L>
      <L subtext="(Imagine the chaos if it had been an entire line of code.)"
        v="Fixed">an issue that in some cases would cause the stash list to
        become unresponsive after restoring a tab that was recently closed.</L>
    </Version>

    <Version v="2.2">
      <L v="Added">options to control whether tabs are hidden or closed when
        they are stashed.</L>
      <L v="Added">advanced options to adjust how aggressively Tab Stash unloads
        hidden tabs that haven't been used recently.</L>
      <L :subtext="`I kept collapsing groups, forgetting they were collapsed, `
                   + `and then wondering where all my tabs went.  Now I `
                   + `know—they were lost at sea in the Disclosure Triangle.`"
         v="Improved"> the styling of collapsed groups in the tab view, to make
        them more visually-distinct from folders that are not collapsed.</L>
      <L v="Fixed">a conflict with keyboard shortcuts on Windows and Linux.  The
        new keyboard shortcuts are as follows:</L>
      <ul>
        <li>Show stashed tabs in sidebar: <em>Ctrl+Alt+S</em></li>
        <li>Stash all open tabs: <em>Ctrl+Alt+T</em></li>
        <li>Stash the active tab: <em>Ctrl+Alt+W</em></li>
      </ul>
      <L subtext="So narrow you couldn't park a motorcycle in it." v="Fixed">
        an issue where the search box wouldn't fit inside the sidebar if the
        sidebar was really narrow.</L>
    </Version>

    <Version v="2.1">
      <L :subtext="`&quot;Users&quot; means you. Thank you for reading this. `
                   + `You are awesome.`"
         v="Added"> a "What's New?" page and unobtrusive notification to let
        users know when new features are available.
      </L>
      <L v="Fixed">an issue where the sidebar may not open automatically when
        stashing tabs.</L>
      <L v="Fixed">an issue that prevents the list of unstashed tabs from
        updating when a tab is torn off into a new window.</L>
    </Version>

    <Version v="2.0">
      <L v="Added">a new "stashed tabs" tab which presents your stash in a
        full-window, multi-column view.</L>
      <L v="Added">a preference to choose whether to automatically open the
        sidebar or the tab view when stashing tabs.</L>
      <L v="Added">a search box. Search your stash by clicking on the "Search
        ..." label at the top of the stash view.</L>
      <L v="Added">keyboard shortcuts. Re-open stashed tabs and groups in the
        background by Ctrl+ or Cmd+clicking the tab/folder.</L>
      <L v="Improved">the aesthetics of the stashed-tabs view.</L>
      <L v="Fixed">stashing of pinned tabs if explicitly requested (by clicking
        a "Stash This Tab" button).</L>
    </Version>

    <Version v="1.0">
      <L v="Fixed">various bugs, mostly pertaining to display or updating issues
        in the "Stashed Tabs" sidebar.</L>
    </Version>

    <Version v="0.9">
      <li>Initial experimental release</li>
    </Version>
  </div>
</div>
</template>

<script lang="ts">
import Version from './whats-new/version.vue';
import L from './whats-new/item.vue';

export default {
    components: {
        Version,
        L,
    },
}
</script>

<style>

</style>
