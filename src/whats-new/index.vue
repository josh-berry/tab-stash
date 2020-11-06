<template>
<main>
  <header class="page action-container">
    <a class="action back" title="Back to Tab Stash"
       :href="pageref('stash-list.html')"></a>
    <h1 class="title">What's New in Tab Stash</h1>
  </header>

  <div class="folder-list one-column">

    <Version v="2.7">
      <L :subtext="`Unlike the plastic in the oceans, your deleted tabs will `
                 + `eventually decompose, turning back into bits.  Studies `
                 + `suggest about two-thirds of all bits are consumed by the `
                 + `most common life-form on the Internet—cats.`"
         :issue="20" v="New:">Tab Stash now remembers deleted items for a period
      of time (180 days by default).  Deleted items are saved locally on each
      computer and can be found in the "Deleted Items" menu in the stash UI.</L>

      <L v="New:">A "close all stashed tabs" button was added to the "Unstashed
      Tabs" toolbar.</L>

      <L :issue="67" v="Improved:">The import and export dialogs have some
      additional help text and polishing to make them easier to use.</L>

      <L :subtext="`If it falls off, simply turn it over, moisten, and `
                 + `gently press it back into place.  Start from the center `
                 + `and work toward the edges to avoid wrinkling.`"
         :issue="69" v="Improved:">The search box now sticks to the top of the
      page when you scroll, so it's always visible.</L>

      <L :issue="71" v="Improved:">The main menu icon has been changed to use a
      standard menu symbol, rather than the Tab Stash logo.</L>

      <L v="Improved:">Lots of "behind-the-scenes" changes have been made to
      improve general stability and prepare for upcoming features.</L>

      <L :issue="91" v="Fixed:">If Multi-Account Containers was installed and a
      URL set to auto-open in a container were imported, the import process
      would freeze.  Import now works correctly with Multi-Account Containers
      and other Firefox tab-container extensions.</L>
    </Version>

    <Version v="2.6">
      <L :issue="[11, 17]" v="Added">import and export for a variety of formats,
      including OneTab and Markdown.</L>

      <L v="Added">a main menu with easy access to import/export, options, help,
      and a new command to fetch missing website icons.</L>

      <L :subtext="`All icons are stored six feet/two meters apart.  Icons `
         + `without a mask will not be permitted in the alpha channel.`"
         :issue="47" v="Improved">caching of website icons.  Icons are now
      stored per page, fixing incorrect icons for Google Drive and other sites
      which use multiple icons.  <strong>Tab Stash now requires "unlimited local
      storage" permissions</strong> to ensure we have space to store all those
      icons.</L>

      <L :issue="[41, 49]" v="Fixed">a rare issue that might cause Tab Stash to
      stop displaying your stashes if a Firefox sync conflict occurs, or a
      duplicate "Tab Stash" folder exists.  We now detect situations that might
      lead to this problem and warn/guide you through resolving it.</L>
    </Version>

    <Version v="2.5">
      <L subtext="Oooooh, spooookyyy~" :issue="16" v="Added">support for dark
        mode.  To use Tab Stash's dark theme, you must have dark mode turned on
        in your system settings (not just in the browser).  Firefox will then
        automatically select the appropriate color scheme.</L>
      <L v="Improved">behavior when stashing single tabs.  If the top-most stash
        wasn't created recently, Tab Stash will create a new one for you rather
        than adding to the old one.</L>
      <L :issue="37" v="Improved">behavior when restoring tabs.  We no longer
        close the Tab Stash tab just because you clicked on something in your
        stash; we leave it open in the background instead.</L>
      <L :issue="34" v="Improved">the UI's appearance in small ways, including
        the color of the Tab Stash icon, which is now neutral so it is visible
        in both dark and light themes.</L>
      <L v="Fixed">an issue preventing the "Close all open tabs" button from
        working correctly in newer versions of Firefox.</L>
      <L :subtext="`Sorry for the inconvenience. :/`"
         :issue="31" v="Removed">the bookmark de-duplication feature.  There is
        a bug in which de-duplication may remove bookmarks which are not
        duplicates if multiple stashes are in progress.  This bug happens very
        rarely, but is serious enough I've decided to remove the feature until a
        solution can be found.</L>
    </Version>

    <Version v="2.4">
      <L :issue="24" v="Added">support for stashing tabs which are in Reader
        View.  Due to Firefox security restrictions, there are some caveats:</L>
      <ul>
        <li>The "Stash this tab" icon will not appear in the address bar for
          Reader View pages.  You can instead use the right-click menu to stash
          individual Reader View tabs.</li>
        <li>Tab Stash cannot restore tabs directly to Reader View, so if a tab
          is no longer available (e.g. it was closed and removed from Firefox's
          cache), we will restore it to the normal website view.</li>
      </ul>
      <L :issue="2" v="Added">a record of which groups are visible and which
        are collapsed.  If you collapse a group, we will now remember that, and
        we won't show you its contents again unless you ask (even if you restart
        your browser).</L>
      <L :subtext="`Icons are locally-sourced from websites using only `
                   + `sustainable fetching practices.  Certified 100% `
                   + `inorganic, non-GMO, gluten-free.`"
         :issue="3" v="Improved">your privacy by replacing the Google icon
        service with a local cache of website icons.  Note that <b>some of your
        website icons will go missing</b> until you visit the site and the cache
        can be populated&mdash;this is normal.</L>
      <L :issue="25" v="Fixed">an issue causing Tab Stash to mistakenly close a
        tab that was just opened if multiple tabs are restored in quick
        succession.</L>
      <L :issue="27" v="Fixed">an issue in which Tab Stash mistakenly allows
        stashing tabs with local files (<code>file:///...</code> URLs).  Tab
        Stash cannot restore these tabs due to Firefox security restrictions, so
        we now treat them as system tabs which aren't stashable.</L>
      <L :issue="28" v="Fixed">an issue where some tabs would be restored to the
        wrong window if you quickly switch windows while a restore is happening.
        We will now ensure all tabs appear in the correct window even if it's no
        longer active.</L>
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
      <L :issue="6" v="Added">the ability to stash multiple selected tabs at
        once in <a href="https://www.mozilla.org/en-US/firefox/64.0/releasenotes/">Firefox 64</a>
        and newer.  Just Ctrl/Cmd- or Shift-click on the tabs you want to
        stash, and then click any
        <img class="inl" src="icons/dark/stash.svg" alt="multi-stash">
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
</main>
</template>

<script lang="ts">
import Vue from 'vue';
import launch, {pageref} from '../launch-vue';

import Options from "../model/options";
import {resolveNamed} from '../util';

import Version from './version.vue';
import L from './item.vue';

const Main = Vue.extend({
    components: {
        Version,
        L,
    },
    provide() {
        return {the_last_notified_version: this.last_notified_version};
    },
    props: {
        last_notified_version: String,
    },
    methods: {
        pageref,
    },
});
export default Main;

launch(Main, async() => {
    const r = await resolveNamed({
        options: Options.local(),
        extn: browser.management.getSelf(),
    });
    (<any>globalThis).options = r.options;

    // If we are caught up to the current version, just show everything.
    const version = r.options.last_notified_version == r.extn.version
        ? undefined : r.options.last_notified_version;

    r.options.set({last_notified_version: r.extn.version});

    return {
        propsData: {
            last_notified_version: version,
        },
    };
});
</script>

<style>

</style>
