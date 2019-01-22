<template>
<div>
  <header>
    <h1>What's New in Tab Stash</h1>

    <div class="status-text">
      <a href="stash-list.html">&#x2190; Back to Tab Stash</a>
    </div>
  </header>

  <div class="folder-list">

    <Version v="2.2">
      <Improved subtext="I kept collapsing groups, forgetting they were collapsed, and then wondering where all my tabs went.  Now I know—they were lost at sea in the Disclosure Triangle.">
        the styling of collapsed groups in the tab view, to make them
        more visually-distinct from folders that are not collapsed.</Improved>
      <Fixed>a conflict with keyboard shortcuts on Windows and Linux.  The new
        keyboard shortcuts are as follows:</Fixed>
      <ul>
        <li>Show stashed tabs in sidebar: <em>Ctrl+Alt+S</em></li>
        <li>Stash all open tabs: <em>Ctrl+Alt+T</em></li>
        <li>Stash the active tab: <em>Ctrl+Alt+W</em></li>
      </ul>
    </Version>

    <Version v="2.1">
      <Added subtext="&quot;Users&quot; means you. Thank you for reading this. You are awesome.">
        a "What's New?" page and unobtrusive notification to let users know when
        new features are available.
      </Added>
      <Fixed>an issue where the sidebar may not open automatically when stashing
        tabs.</Fixed>
      <Fixed>an issue that prevents the list of unstashed tabs from updating
        when a tab is torn off into a new window.</Fixed>
    </Version>

    <Version v="2.0">
      <Added>a new "stashed tabs" tab which presents your stash in a
        full-window, multi-column view.</Added>
      <Added>a preference to choose whether to automatically open the
        sidebar or the tab view when stashing tabs.</Added>
      <Added>a search box. Search your stash by clicking on the "Search
        ..." label at the top of the stash view.</Added>
      <Added>keyboard shortcuts. Re-open stashed tabs and groups in the
        background by Ctrl+ or Cmd+clicking the tab/folder.</Added>
      <Improved>the aesthetics of the stashed-tabs view.</Improved>
      <Fixed>stashing of pinned tabs if explicitly requested (by clicking a
        "Stash This Tab" button).</Fixed>
    </Version>

    <Version v="1.0">
      <Fixed>various bugs, mostly pertaining to display or updating issues in
        the "Stashed Tabs" sidebar.</Fixed>
    </Version>

    <Version v="0.9">
      <li>Initial experimental release</li>
    </Version>
  </div>
</div>
</template>

<script>
import Version from './whats-new/version.vue';
import Added from './whats-new/added.vue';
import Improved from './whats-new/improved.vue';
import Fixed from './whats-new/fixed.vue';
import Removed from './whats-new/removed.vue';

export default {
    components: {
        Version,
        Added,
        Improved,
        Fixed,
        Removed,
    },
}
</script>

<style>

</style>
