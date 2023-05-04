<template>
  <main>
    <header class="page action-container">
      <a
        class="action back"
        title="Back to Tab Stash"
        :href="pageref('stash-list.html')"
      ></a>
      <h1>What's New in Tab Stash</h1>
    </header>

    <ul class="forest one-column">
      <Version v="2.12.1">
        <L v="Improved" :issue="335"
          >loading of website icons to avoid crashes when your system is running
          slowly.</L
        >

        <L v="Fixed" :issue="308"
          >the color of the Tab Stash tab's icon when in dark mode.</L
        >
      </Version>

      <Version v="2.12.0.1">
        <L v="Fixed">a packaging issue preventing upload to Mozilla.</L>
      </Version>

      <Version v="2.12">
        <L :issue="268" v="Added"
          >a confirmation before closing lots of open tabs.</L
        >

        <L :issue="299" v="Added">a button to clear the search box.</L>

        <L :issue="109" v="Added"
          >an option to the importer to skip loading titles and icons. If
          loading is skipped, the importer will try to auto-detect page titles
          where possible.</L
        >

        <L :issue="125" v="Experiment Released:"
          >Container tabs now have small colored bars showing which container
          the tab belongs to.</L
        >

        <L :issue="298" v="Improved"
          >the process of restoring tabs. Tabs are auto-loaded once again, but
          slowly so as to avoid overwhelming your computer. There is a new
          setting to revert to the previous behavior of loading tabs lazily if
          you still run into performance issues.</L
        >

        <L v="Improved"
          >reliability and performance of importing tabs and updating website
          icons. Tab Stash will now load tabs in parallel based on how many
          cores are available on your computer, and will retry failed tabs a few
          times before giving up.</L
        >

        <L v="Fixed"
          >a crash that occurred on rare occasions when saving website icons to
          the cache.</L
        >

        <L :issue="306" v="Fixed"
          >an issue where the importer would sometimes detect invalid characters
          as being part of URLs.</L
        >
      </Version>

      <Version v="2.11.1">
        <L :issue="295" v="Fixed"
          >an issue that prevented drag-and-drop of two consecutive items in the
          same stash.</L
        >

        <L :issue="293" v="Fixed:"
          >When dragging a single tab out of the stash and back into the window,
          actually restore the tab instead of deleting it.</L
        >

        <L v="Fixed"
          >an issue that occasionally caused tabs to be restored in the wrong
          position. When dragging tabs out of the stash and back into the
          window, they are now placed in the correct position relative to other
          open tabs.</L
        >
      </Version>

      <Version v="2.11.0.1">
        <L v="Fixed">a build issue identified by Mozilla during review.</L>
      </Version>

      <Version v="2.11">
        <L :issue="168" :pr="258" thanks="sleak75" v="New:"
          >Rename stashed tabs by clicking the "Edit" icon.</L
        >

        <L :issue="185" :pr="221" thanks="KerfuffleV2" v="New:"
          >Show stats about each group of stashed tabs by hovering over the
          stash name.</L
        >

        <L :issue="116" v="Experiment Released:"
          >Click the "Unstashed Tabs" heading to toggle between showing all
          open/unpinned tabs and just unstashed tabs.</L
        >

        <L :issue="125" :pr="219" thanks="KerfuffleV2" v="New Experiment:"
          >Show a colorized marker for tabs which belong to a container.</L
        >

        <L :issue="215" :pr="216" thanks="KerfuffleV2" v="Improved:"
          >Middle-clicking an open tab will now close it, and middle-clicking a
          closed tab will now open it.</L
        >

        <L :issue="129" v="Improved"
          >performance when unstashing large numbers of tabs, by lazily loading
          them only when activated.</L
        >

        <L :issue="46" v="Improved:"
          >Tab Stash will no longer create duplicate tabs when moving into a
          stash if a tab already exists in that stash.</L
        >

        <L :pr="225" thanks="KerfuffleV2" v="Improved:"
          >Display an animation while a tab is being loaded.</L
        >

        <L :pr="220" thanks="KerfuffleV2" v="Improved:"
          >Tabs which are unloaded now appear dimmed.</L
        >

        <L :issue="240" :pr="241" thanks="KerfuffleV2" v="Fixed"
          >an issue that may cause high CPU usage when the stash is completely
          empty.</L
        >

        <L :issue="[228, 272]" :pr="[233, 237, 241]" v="Fixed"
          >various small issues related to drag-and-drop, UI styling/behavior,
          and performance.</L
        >
      </Version>

      <Version v="2.10.3">
        <L :issue="214" v="Fixed"
          >a crash that may occur if website icons take too long to load when
          first opening the UI. ("NanoTimeoutError")</L
        >

        <L :issue="223" v="Fixed"
          >a crash that may occur if the Tab Stash UI loses contact with the Tab
          Stash background page. ("Disconnected" error)</L
        >
      </Version>

      <Version v="2.10.2">
        <L
          :subtext="
            `If you find that your laptop isn't keeping your lap as ` +
            `warm as it used to after this update, may I recommend ` +
            `a cat instead?  Replacing your laptop with a cat can reduce ` +
            `your power bill, since cats are solar-powered.  Cats also send ` +
            `fewer notifications and are easier to pet.`
          "
          :issue="172"
          v="Improved:"
          >Processing and cleanup of deleted items now uses much less CPU.</L
        >

        <L :issue="201" v="Improved:"
          >The "safety net" added in v2.10.1 will now use much less CPU if it is
          invoked repeatedly. Also, if a crash occurs, a (hopefully) helpful
          error message will be displayed to help with troubleshooting.</L
        >

        <L
          :subtext="
            `Are you REALLY SURE you wanted to delete those tabs?  You ` +
            `are?  Well, I don't believe you.`
          "
          :issue="181"
          v="Fixed"
          >an issue that could prevent loading website icons or deleting stashed
          tabs in some situations.</L
        >

        <L :issue="[179, 190]" v="Fixed"
          >an issue causing stashed or imported tabs to be added to a
          recently-created group by mistake. Stashing or importing multiple tabs
          at once will now create a new group as expected.</L
        >

        <L :issue="204" v="Fixed:"
          >Import will now ignore invalid URLs and empty groups without
          crashing.</L
        >

        <L :issue="210" v="Fixed:"
          >The collapsed state of "Unstashed Tabs" will no longer be forgotten
          on browser restart (or once a day).</L
        >

        <L :issue="188" v="Removed:"
          >Tab Stash will no longer restore tabs that were recently-closed.
          Recent versions of Firefox introduced a bug which made this
          functionality restore the wrong tab at times. (This feature is still
          available as an experimental feature for those who want to continue
          using it.)</L
        >
      </Version>

      <Version v="2.10.1">
        <L v="Improved:"
          >Added a "safety net" which reloads the browser data used to display
          the UI if the UI detects that it's gotten out of sync with the
          browser.</L
        >

        <L v="Fixed"
          >an issue which would sometimes cause Tab Stash to lose track of the
          focused window, preventing the UI from opening.</L
        >

        <L v="Fixed"
          >an issue that would in some cases cause Tab Stash to lose track of
          tabs that are moved between windows.</L
        >

        <L v="Fixed:"
          >Restoring a tab that's already open in another window will no longer
          move the tab from the other window into the current one. A new tab
          will be created instead.</L
        >
      </Version>

      <Version v="2.10">
        <L :issue="57" v="New:"
          >Select and move multiple tabs at once using drag-and-drop or the new
          selection menu. Click on a tab's icon to get started!</L
        >

        <L v="New:"
          >If you want to see which tabs in a particular group don't match your
          search, click the "+ N Filtered" label to show all tabs in that
          group.</L
        >

        <L :issue="118" v="Improved:"
          >Group names are now searched along with tab titles and URLs. If you
          have a lot of groups, it's now easier to find the one you're looking
          for.</L
        >

        <L :issue="160" v="Improved:"
          >"Delete" buttons are now shown even on collapsed groups. Now that Tab
          Stash can un-delete items, there's no reason to hide the "delete"
          buttons anymore since a mistake is easy to fix.</L
        >

        <L v="Improved"
          >the aesthetics of the UI in various small ways (most notably, a
          default icon is now shown for tabs that don't have one).</L
        >

        <L
          :subtext="
            `Tab Stash now uses Vue 3, and a number of off-the-shelf ` +
            `components were replaced with custom implementations to make the ` +
            `code cleaner, simpler and faster. There is also a completely ` +
            `rewritten model and a LOT more automated tests.`
          "
          v="Improved:"
          >Lots of behind-the-scenes improvements to pave the way for new
          features and better performance.</L
        >

        <L :issue="122" v="Fixed:"
          >Tab Stash no longer stashes new/blank tabs. This also means that, if
          we are asked to stash tabs when only a new tab is open, we won't
          create a group with just a single, lonely new tab.</L
        >
      </Version>

      <Version v="2.9">
        <L :issue="108" v="New:"
          >Force Tab Stash to use either light or dark colors from the options
          page, so you can use Tab Stash with any browser theme and the colors
          won't clash.</L
        >

        <L :issue="13" v="New:"
          >Switch between "compact" and "normal" spacing and fonts from the
          options page, so you can see more of your stashes at once.</L
        >

        <L
          :subtext="
            `If you ever get lost, don't panic.  Just ask the nearest ` +
            `Internet cat for directions.  You probably won't get a ` +
            `helpful response—you're talking to a cat, after all—but ` +
            `you'll feel better for having tried.`
          "
          :issue="89"
          v="Improved:"
          >The active tab is now marked, so you can always see where you are.</L
        >

        <L
          :subtext="
            `I'm genuinely grateful for all the feedback—both positive ` +
            `and negative—I've gotten over the last 2.5 years of ` +
            `building Tab Stash.  It's been constructive and inspiring, ` +
            `and you've all been marvelous to work with.`
          "
          ><b
            >Tab Stash is now part of Mozilla's Recommended Extensions
            program!</b
          >
          Thank you to everyone who's helped make Tab Stash better&mdash;whether
          that's leaving a review, filing a bug report, or even sending in
          patches. It wouldn't have been possible without you!</L
        >
      </Version>

      <Version v="2.8.1">
        <L>Changed build parameters as requested by Mozilla.</L>

        <L v="Fixed"
          >an issue loading settings that were set to invalid values (e.g. due
          to manual editing of the settings object).</L
        >
      </Version>

      <Version v="2.8">
        <L :issue="21" v="New:"
          >The behavior of the Tab Stash button in your browser's toolbar can
          now be customized. Choose "Options..." from the Tab Stash menu to
          change the setting.</L
        >

        <L :issue="64" v="New:"
          >Allow all URLs (except URLs to Tab Stash itself) to be stashed and
          restored. Privileged URLs which cannot be opened by Tab Stash will
          instead show an intermediate page to make it easy to open the URL
          manually.</L
        >

        <L :issue="101" v="Improved:"
          >In the full-page UI, allow tabs to be dropped anywhere inside the
          folder box, not just immediately after the last tab in the list.</L
        >

        <L :issue="103" v="Fixed:"
          >Occasionally, when Tab Stash is first installed, it may create two
          root "Tab Stash" folders, causing a warning in the UI. This can happen
          if the UI is opened before the extension has finished starting up. We
          now detect and remove the extra folder.</L
        >
      </Version>

      <Version v="2.7.1">
        <L v="Fixed:"
          >During import, sites that take too long to load may be imported with
          missing titles and/or icons. We now wait longer, and measure
          time-to-load in a smarter way that is less likely to lead to premature
          timeouts.</L
        >
      </Version>

      <Version v="2.7">
        <L
          :subtext="
            `Unlike the plastic in the oceans, your deleted tabs will ` +
            `eventually decompose, turning back into bits.  Studies ` +
            `suggest about two-thirds of all bits are consumed by the ` +
            `most common life-form on the Internet—cats.`
          "
          :issue="20"
          v="New:"
          >Tab Stash now remembers deleted items for a period of time (180 days
          by default). Deleted items are saved locally on each computer and can
          be found in the "Deleted Items" menu in the stash UI.</L
        >

        <L v="New:"
          >A "close all stashed tabs" button was added to the "Unstashed Tabs"
          toolbar.</L
        >

        <L :issue="67" v="Improved:"
          >The import and export dialogs have some additional help text and
          polishing to make them easier to use.</L
        >

        <L
          :subtext="
            `If it falls off, simply turn it over, moisten, and ` +
            `gently press it back into place.  Start from the center ` +
            `and work toward the edges to avoid wrinkling.`
          "
          :issue="69"
          v="Improved:"
          >The search box now sticks to the top of the page when you scroll, so
          it's always visible.</L
        >

        <L :issue="71" v="Improved:"
          >The main menu icon has been changed to use a standard menu symbol,
          rather than the Tab Stash logo.</L
        >

        <L v="Improved:"
          >Lots of "behind-the-scenes" changes have been made to improve general
          stability and prepare for upcoming features.</L
        >

        <L :issue="91" v="Fixed:"
          >If Multi-Account Containers was installed and a URL set to auto-open
          in a container were imported, the import process would freeze. Import
          now works correctly with Multi-Account Containers and other Firefox
          tab-container extensions.</L
        >
      </Version>

      <Version v="2.6">
        <L :issue="[11, 17]" v="Added"
          >import and export for a variety of formats, including OneTab and
          Markdown.</L
        >

        <L v="Added"
          >a main menu with easy access to import/export, options, help, and a
          new command to fetch missing website icons.</L
        >

        <L
          :subtext="
            `All icons are stored six feet/two meters apart.  Icons ` +
            `without a mask will not be permitted in the alpha channel.`
          "
          :issue="47"
          v="Improved"
          >caching of website icons. Icons are now stored per page, fixing
          incorrect icons for Google Drive and other sites which use multiple
          icons.
          <strong
            >Tab Stash now requires "unlimited local storage"
            permissions</strong
          >
          to ensure we have space to store all those icons.</L
        >

        <L :issue="[41, 49]" v="Fixed"
          >a rare issue that might cause Tab Stash to stop displaying your
          stashes if a Firefox sync conflict occurs, or a duplicate "Tab Stash"
          folder exists. We now detect situations that might lead to this
          problem and warn/guide you through resolving it.</L
        >
      </Version>

      <Version v="2.5">
        <L subtext="Oooooh, spooookyyy~" :issue="16" v="Added"
          >support for dark mode. To use Tab Stash's dark theme, you must have
          dark mode turned on in your system settings (not just in the browser).
          Firefox will then automatically select the appropriate color
          scheme.</L
        >
        <L v="Improved"
          >behavior when stashing single tabs. If the top-most stash wasn't
          created recently, Tab Stash will create a new one for you rather than
          adding to the old one.</L
        >
        <L :issue="37" v="Improved"
          >behavior when restoring tabs. We no longer close the Tab Stash tab
          just because you clicked on something in your stash; we leave it open
          in the background instead.</L
        >
        <L :issue="34" v="Improved"
          >the UI's appearance in small ways, including the color of the Tab
          Stash icon, which is now neutral so it is visible in both dark and
          light themes.</L
        >
        <L v="Fixed"
          >an issue preventing the "Close all open tabs" button from working
          correctly in newer versions of Firefox.</L
        >
        <L :subtext="`Sorry for the inconvenience. :/`" :issue="31" v="Removed"
          >the bookmark de-duplication feature. There is a bug in which
          de-duplication may remove bookmarks which are not duplicates if
          multiple stashes are in progress. This bug happens very rarely, but is
          serious enough I've decided to remove the feature until a solution can
          be found.</L
        >
      </Version>

      <Version v="2.4">
        <L :issue="24" v="Added"
          >support for stashing tabs which are in Reader View. Due to Firefox
          security restrictions, there are some caveats:</L
        >
        <ul>
          <li>
            The "Stash this tab" icon will not appear in the address bar for
            Reader View pages. You can instead use the right-click menu to stash
            individual Reader View tabs.
          </li>
          <li>
            Tab Stash cannot restore tabs directly to Reader View, so if a tab
            is no longer available (e.g. it was closed and removed from
            Firefox's cache), we will restore it to the normal website view.
          </li>
        </ul>
        <L :issue="2" v="Added"
          >a record of which groups are visible and which are collapsed. If you
          collapse a group, we will now remember that, and we won't show you its
          contents again unless you ask (even if you restart your browser).</L
        >
        <L
          :subtext="
            `Icons are locally-sourced from websites using only ` +
            `sustainable fetching practices.  Certified 100% ` +
            `inorganic, non-GMO, gluten-free.`
          "
          :issue="3"
          v="Improved"
          >your privacy by replacing the Google icon service with a local cache
          of website icons. Note that
          <b>some of your website icons will go missing</b> until you visit the
          site and the cache can be populated&mdash;this is normal.</L
        >
        <L :issue="25" v="Fixed"
          >an issue causing Tab Stash to mistakenly close a tab that was just
          opened if multiple tabs are restored in quick succession.</L
        >
        <L :issue="27" v="Fixed"
          >an issue in which Tab Stash mistakenly allows stashing tabs with
          local files (<code>file:///...</code> URLs). Tab Stash cannot restore
          these tabs due to Firefox security restrictions, so we now treat them
          as system tabs which aren't stashable.</L
        >
        <L :issue="28" v="Fixed"
          >an issue where some tabs would be restored to the wrong window if you
          quickly switch windows while a restore is happening. We will now
          ensure all tabs appear in the correct window even if it's no longer
          active.</L
        >
      </Version>

      <Version v="2.3.1">
        <L
          :subtext="
            `This bug got introduced in 2.3 because, ironically, I made ` +
            `some changes to try to catch more issues like this before they ` +
            `made it into a release.`
          "
          v="Fixed"
          >an issue preventing the sidebar from opening after stashing tabs when
          the (default) option "<em
            >Automatically show your stashed tabs in the sidebar</em
          >" is chosen. The tabs would get saved correctly, but you'd have no
          idea where they went because the sidebar wouldn't open.</L
        >
      </Version>

      <Version v="2.3">
        <L :issue="6" v="Added"
          >the ability to stash multiple selected tabs at once in
          <a href="https://www.mozilla.org/en-US/firefox/64.0/releasenotes/"
            >Firefox 64</a
          >
          and newer. Just Ctrl/Cmd- or Shift-click on the tabs you want to
          stash, and then click any "stash" button.</L
        >
        <L v="Added"
          >the ability to manage collapsed groups in the sidebar. When you hover
          over a collapsed group, the group's "Stash..." and "Open..." buttons
          will now appear.</L
        >
        <L v="Improved"
          >the ordering of context-menu items to put more commonly-used items
          first.</L
        >
        <L :issue="8" v="Fixed"
          >a poor interaction between Tab Stash and Firefox Sync that would
          occasionally cause stashed tabs to get mis-filed so they no longer
          appear in the stash. To recover any missing tabs, see:</L
        >
        <L v="Fixed"
          >an issue where the "Close all open tabs" button wasn't respecting the
          "hide" vs. "close" stashed tabs setting.</L
        >
      </Version>

      <Version v="2.2.1">
        <L
          subtext="Fun fact: This bug was caused by a single-letter typo."
          v="Fixed"
          >an issue preventing Tab Stash from closing hidden tabs associated
          with bookmarks that were deleted from the stash.</L
        >
        <L
          subtext="Fun fact: This bug was caused by the SAME single-letter typo."
          v="Fixed"
          >an issue preventing Tab Stash from unloading old hidden tabs
          correctly.</L
        >
        <L
          :subtext="
            `Yep... this one too. (If you really want to know, a 'T' ` +
            `was capitalized when it should have been lowercase.)`
          "
          v="Fixed"
          >an issue preventing Tab Stash from automatically deleting empty
          folders in the stash.</L
        >
        <L
          :issue="4"
          subtext="This bug was caused by a whole WORD being wrong."
          v="Fixed"
          >an issue where the option to close instead of hide stashed tabs
          wasn't being respected.</L
        >
        <L
          subtext="(Imagine the chaos if it had been an entire line of code.)"
          v="Fixed"
          >an issue that in some cases would cause the stash list to become
          unresponsive after restoring a tab that was recently closed.</L
        >
      </Version>

      <Version v="2.2">
        <L v="Added"
          >options to control whether tabs are hidden or closed when they are
          stashed.</L
        >
        <L v="Added"
          >advanced options to adjust how aggressively Tab Stash unloads hidden
          tabs that haven't been used recently.</L
        >
        <L
          :subtext="
            `I kept collapsing groups, forgetting they were collapsed, ` +
            `and then wondering where all my tabs went.  Now I ` +
            `know—they were lost at sea in the Disclosure Triangle.`
          "
          v="Improved"
        >
          the styling of collapsed groups in the tab view, to make them more
          visually-distinct from folders that are not collapsed.</L
        >
        <L v="Fixed"
          >a conflict with keyboard shortcuts on Windows and Linux. The new
          keyboard shortcuts are as follows:</L
        >
        <ul>
          <li>Show stashed tabs in sidebar: <em>Ctrl+Alt+S</em></li>
          <li>Stash all open tabs: <em>Ctrl+Alt+T</em></li>
          <li>Stash the active tab: <em>Ctrl+Alt+W</em></li>
        </ul>
        <L subtext="So narrow you couldn't park a motorcycle in it." v="Fixed">
          an issue where the search box wouldn't fit inside the sidebar if the
          sidebar was really narrow.</L
        >
      </Version>

      <Version v="2.1">
        <L
          :subtext="
            `&quot;Users&quot; means you. Thank you for reading this. ` +
            `You are awesome.`
          "
          v="Added"
        >
          a "What's New?" page and unobtrusive notification to let users know
          when new features are available.
        </L>
        <L v="Fixed"
          >an issue where the sidebar may not open automatically when stashing
          tabs.</L
        >
        <L v="Fixed"
          >an issue that prevents the list of unstashed tabs from updating when
          a tab is torn off into a new window.</L
        >
      </Version>

      <Version v="2.0">
        <L v="Added"
          >a new "stashed tabs" tab which presents your stash in a full-window,
          multi-column view.</L
        >
        <L v="Added"
          >a preference to choose whether to automatically open the sidebar or
          the tab view when stashing tabs.</L
        >
        <L v="Added"
          >a search box. Search your stash by clicking on the "Search ..." label
          at the top of the stash view.</L
        >
        <L v="Added"
          >keyboard shortcuts. Re-open stashed tabs and groups in the background
          by Ctrl+ or Cmd+clicking the tab/folder.</L
        >
        <L v="Improved">the aesthetics of the stashed-tabs view.</L>
        <L v="Fixed"
          >stashing of pinned tabs if explicitly requested (by clicking a "Stash
          This Tab" button).</L
        >
      </Version>

      <Version v="1.0">
        <L v="Fixed"
          >various bugs, mostly pertaining to display or updating issues in the
          "Stashed Tabs" sidebar.</L
        >
      </Version>

      <Version v="0.9">
        <li>Initial experimental release</li>
      </Version>
    </ul>
  </main>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import {pageref} from "../launch-vue";

import L from "./item.vue";
import Version from "./version.vue";

export default defineComponent({
  components: {Version, L},
  methods: {pageref},
});
</script>

<style></style>
