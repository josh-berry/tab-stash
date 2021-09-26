<template>
<main :class="{'show-advanced': meta_show_advanced}">
  <section class="advanced show-advanced">
    <label for="meta_show_advanced">
        <input type="checkbox" id="meta_show_advanced"
              v-model="meta_show_advanced" />
        Show advanced settings
    </label>
  </section>

  <hr>

  <h4>Tab Stash Behavior (All Synced Browsers)</h4>
  <section>
    <label>When the toolbar button is clicked:</label>
    <ul><li>
      <select id="browser_action_stash" v-model="browser_action_stash">
        <option :disabled="browser_action_show === 'popup'"
                value="all">Stash all (or selected) tabs</option>
        <option :disabled="browser_action_show === 'popup'"
                value="single">Stash the active tab</option>
        <option :disabled="browser_action_show === 'none'"
                value="none">Don't stash any tabs</option>
      </select>
      and
      <select id="browser_action_show" v-model="browser_action_show">
        <option v-if="hasSidebar" value="sidebar">show the stash in the sidebar</option>
        <option value="tab">show the stash in a tab</option>
        <option v-if="ff_popup_view" value="popup">show the stash in a popup</option>
        <option :disabled="browser_action_stash === 'none'"
                value="none">don't show the stash</option>
      </select>
    </li></ul>
  </section>

  <section>
    <label>When stashing tabs from the context menu or address bar:</label>
    <ul>
      <li v-if="hasSidebar"><label for="open_stash_in_sidebar">
          <input type="radio" name="open_stash_in" id="open_stash_in_sidebar"
                v-model="open_stash_in" value="sidebar" />
          Show the stash in the sidebar
      </label></li>
      <li><label for="open_stash_in_tab">
          <input type="radio" name="open_stash_in" id="open_stash_in_tab"
                v-model="open_stash_in" value="tab" />
          Show the stash in a tab
      </label></li>
      <li><label for="open_stash_in_none">
          <input type="radio" name="open_stash_in" id="open_stash_in_none"
                v-model="open_stash_in" value="none" />
          Don't show the stash
      </label></li>
    </ul>
  </section>

  <section class="advanced">
    <label>When stashing a single tab:</label>
    <ul><li>
      <label for="new_folder_timeout_min"
                  title="If the top-most stash has a name, or is older than this, a new, unnamed stash will be created instead.">
        Append to the top-most stash only if it was created in the last
        <input type="number" id="new_folder_timeout_min"
                v-model="new_folder_timeout_min" min="0">
        minutes
      </label>
    </li></ul>
  </section>

  <hr>

  <h4>Appearance (All Synced Browsers)</h4>

  <section class="two-col">
    <label for="ui_metrics">Spacing and Fonts:</label>
    <select id="ui_metrics" v-model="ui_metrics">
        <option value="normal">Normal</option>
        <option value="compact">Compact</option>
    </select>

    <label for="ui_theme">Theme:</label>
    <select id="ui_theme" v-model="ui_theme">
      <option value="system">Same as operating system</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </section>

  <hr>

  <h4>Privacy (All Synced Browsers)</h4>

  <section>
    <label>When deleting items from your stash:</label>
    <ul><li>
      <label for="deleted_items_expiration_days">
        Remember items that were deleted on this computer for
        <input type="number" id="deleted_items_expiration_days"
                v-model="deleted_items_expiration_days" min="1">
        days
      </label>
    </li></ul>
  </section>

  <hr>

  <h4>Tab and Memory Management (This Browser)</h4>
  <section>
    <label>Once a tab has been stashed:</label>
    <ul>
      <li>
        <label for="after_stashing_tab_hide"
                title="Hidden tabs that are still loaded can be restored instantly. They also preserve anything you had entered into the tab and its history (e.g. Back button).">
          <input type="radio"
                name="after_stashing_tab" id="after_stashing_tab_hide"
                v-model="after_stashing_tab" value="hide" />
          Hide the tab and keep it loaded in the background
        </label>
        <ul :class="{disabled: after_stashing_tab !== 'hide'}">
          <li>
            <label for="autodiscard_hidden_tabs"
                  title="Monitors the total number of tabs in your browser, and if you have a lot of tabs open, unloads hidden tabs that haven't been used recently. This option significantly reduces memory usage and is recommended for most users.">
              <input type="checkbox"
                    name="autodiscard_hidden_tabs" id="autodiscard_hidden_tabs"
                    :disabled="after_stashing_tab !== 'hide'"
                    v-model="autodiscard_hidden_tabs" />
              Automatically unload hidden tabs that haven't been used in a while
            </label>
          </li>
          <li>
            <ul :class="{advanced: true,
                          disabled: after_stashing_tab !== 'hide'
                                    || ! autodiscard_hidden_tabs}">
              <li><label for="autodiscard_interval_min">
                  Check for old hidden tabs every
                  <input type="number" id="autodiscard_interval_min"
                        :disabled="after_stashing_tab !== 'hide'
                                    || ! autodiscard_hidden_tabs"
                        v-model="autodiscard_interval_min" min="1">
                  minutes
              </label></li>
              <li><label for="autodiscard_min_keep_tabs">
                  Keep at least
                  <input type="number" id="autodiscard_min_keep_tabs"
                        :disabled="after_stashing_tab !== 'hide'
                                    || ! autodiscard_hidden_tabs"
                        v-model="autodiscard_min_keep_tabs" min="0">
                  hidden and visible tabs loaded at all times
              </label></li>
              <li><label for="autodiscard_target_age_min">
                  Keep the oldest tabs loaded for at least
                  <input type="number" id="autodiscard_target_age_min"
                        :disabled="after_stashing_tab !== 'hide'
                                    || ! autodiscard_hidden_tabs"
                        v-model="autodiscard_target_age_min" min="1">
                  minutes, but...
              </label></li>
              <li><label for="autodiscard_target_tab_count">
                  ...unload tabs more aggressively if there are more than
                  <input type="number" id="autodiscard_target_tab_count"
                        :disabled="after_stashing_tab !== 'hide'
                                    || ! autodiscard_hidden_tabs"
                        v-model="autodiscard_target_tab_count"
                        :min="autodiscard_min_keep_tabs">
                  tabs loaded
              </label></li>
            </ul>
          </li>
        </ul>
      </li>
      <li><label for="after_stashing_tab_hide_discard"
                  title="Hidden tabs that are unloaded can be restored very quickly, and usually without a network connection. They also preserve browsing history (e.g. Back button). However, depending on the website, you may lose anything you had entered into the tab that isn't already saved. Uses less memory.">
        <input type="radio"
              name="after_stashing_tab" id="after_stashing_tab_hide_discard"
              v-model="after_stashing_tab" value="hide_discard" />
        Hide the tab and immediately unload it
      </label></li>
      <li><label for="after_stashing_tab_close"
                  title="Uses the least amount of memory and takes the longest to restore, because tab contents may need to be fetched over the network. This option will cause the browser to forget anything you had entered into the tab, as well as the tab's browsing history (e.g. Back button).">
        <input type="radio"
              name="after_stashing_tab" id="after_stashing_tab_close"
              v-model="after_stashing_tab" value="close" />
        Close the tab immediately
      </label></li>
    </ul>
  </section>

  <hr v-if="meta_show_advanced">

  <section class="advanced">
    <h4>Experimental Features</h4>

    <p><em><b>WARNING:</b> Turning on experimental features may break Tab Stash
    or cause data loss!  They are "experimental" because they are still in
    development and there may be known issues.  Experimental features may change
    significantly or be removed entirely in future versions.</em></p>

    <p><em>To provide feedback or report a problem with a feature, leave a
    comment on the issue linked in [brackets] below.</em></p>

    <FeatureFlag name="ff_popup_view" v-model="ff_popup_view"
                  :default_value="local_def().ff_popup_view.default" :issue="115">
      <template v-slot:summary>Popup View</template>
      Enables additional options (configurable above) to show the Tab Stash UI
      in a popup panel instead of {{hasSidebar ? 'the sidebar or ' : ''}}a tab.
    </FeatureFlag>

    <FeatureFlag name="show_all_open_tabs" v-model="show_all_open_tabs"
                  :default_value="sync_def().show_all_open_tabs.default" :issue="116">
      <template v-slot:summary>Show All Open Tabs</template>
      In the stash list, show all open tabs at the top instead of just the
      unstashed tabs.
    </FeatureFlag>
  </section>
</main>
</template>

<script lang="ts">
import browser from 'webextension-polyfill';
import {PropType, defineComponent, reactive} from 'vue';

import launch from '../launch-vue';
import * as Options from '../model/options';

const prop = (area: string, name: string) => ({
    get: function(this: any) { return this[area][name]; },
    set: function(this: any, v: any) {
        this.model()[area].set({[name]: v}).catch(console.error);
    },
});

function options() {
    let ret: any = {};
    for (let k of Object.keys(Options.LOCAL_DEF)) {
        ret[k] = prop('local', k);
    }
    for (let k of Object.keys(Options.SYNC_DEF)) {
        ret[k] = prop('sync', k);
    }
    return ret;
}

const Main = defineComponent({
    components: {
        FeatureFlag: require('./feature-flag').default,
    },

    props: {
      hasSidebar: Boolean,
      sync: Object as PropType<Options.SyncState>,
      local: Object as PropType<Options.LocalState>,
    },

    computed: options(),

    watch: {
        browser_action_show(val: Options.ShowWhatOpt) {
            switch (val) {
                case 'popup':
                    this.model().sync.set({browser_action_stash: 'none'})
                        .catch(console.error);
                    break;
                case 'none':
                    if (this.model().sync.state.browser_action_stash === 'none') {
                        this.model().sync.set({browser_action_stash: 'single'})
                            .catch(console.error);
                    }
                    break;
            }
        },

        browser_action_stash(val: Options.StashWhatOpt) {
            switch (val) {
                case 'none':
                    if (this.model().sync.state.browser_action_show === 'none') {
                        this.model().sync.set({browser_action_show: 'tab'})
                            .catch(console.error);
                    }
                    break;
                default:
                    if (this.model().sync.state.browser_action_show === 'popup') {
                        this.model().sync.set({browser_action_show: 'tab'})
                            .catch(console.error);
                    }
                    break;
            }
        },
    },

    methods: {
        model(): Options.Model { throw new Error("dummy method overridden below"); },
        local_def() { return Options.LOCAL_DEF; },
        sync_def() { return Options.SYNC_DEF; },
    },
});
export default Main;

launch(Main, async() => {
    const opts = await Options.Model.live();
    (<any>globalThis).model = opts;
    return {
        propsData: reactive({
            hasSidebar: !! browser.sidebarAction,
            sync: opts.sync.state,
            local: opts.local.state,
        }),
        methods: {
            model() { return opts; },
        },
    };
});
</script>

<style>
</style>
