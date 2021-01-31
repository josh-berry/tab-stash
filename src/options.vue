<template>
<main :class="{'show-advanced': meta_show_advanced}">
  <ul>
    <li class="show-advanced advanced">
      <label for="meta_show_advanced">
          <input type="checkbox" id="meta_show_advanced"
                v-model="meta_show_advanced" />
          Show advanced settings
      </label>
    </li>
  </ul>

  <hr>

  <h4>Tab Stash Behavior (All Synced Browsers)</h4>
  <ul>
    <li>
      <label>When the toolbar button is clicked:</label>
      <ul>
        <li>
          <label for="browser_action_stash">
            <select id="browser_action_stash" v-model="browser_action_stash">
              <option value="all">Stash all open tabs</option>
              <option value="single">Stash the active tab</option>
              <option value="none">Don't stash any tabs</option>
            </select>
            to the stash,
          </label>
          <label for="browser_action_show">
            and
            <select id="browser_action_show" v-model="browser_action_show">
              <option value="sidebar">show stashed tabs in the sidebar</option>
              <option value="tab">show stashed tabs in a tab</option>
              <option value="none">don't show the stash</option>
            </select>
          </label>
        </li>
      </ul>
    </li>

    <li>
      <label>When the address bar button is clicked:</label>
      <ul>
        <li>
          <label for="page_action_stash">
            <select id="page_action_stash" v-model="page_action_stash">
              <option value="all">Stash all open tabs</option>
              <option value="single">Stash the active tab</option>
              <option value="none">Don't stash any tabs</option>
            </select>
            to the stash,
          </label>
          <label for="page_action_show">
            and
            <select id="page_action_show" v-model="page_action_show">
              <option value="sidebar">show stashed tabs in the sidebar</option>
              <option value="tab">show stashed tabs in a tab</option>
              <option value="none">don't show the stash</option>
            </select>
          </label>
        </li>
      </ul>
    </li>

    <li>
      <label>After stashing tabs from the context menu:</label>
      <ul>
        <li><label>
          <select id="context_menu_show" v-model="context_menu_show">
            <option value="sidebar">Show stashed tabs in the sidebar</option>
            <option value="tab">Show stashed tabs in a tab</option>
            <option value="none">Don't show the stash</option>
          </select>
        </label></li>
      </ul>
    </li>

    <li class="advanced">
      <label>When stashing a single tab:</label>
      <ul>
        <li><label for="new_folder_timeout_min"
                   title="If the top-most stash has a name, or is older than this, a new, unnamed stash will be created instead.">
          Append to the top-most stash only if it was created in the last
          <input type="number" id="new_folder_timeout_min"
                  v-model="new_folder_timeout_min" min="0">
          minutes
        </label></li>
      </ul>
    </li>
  </ul>

  <hr>

  <h4>Privacy (All Synced Browsers)</h4>

  <ul>
    <li>
      <label>When deleting items from your stash:</label>
      <ul>
        <li><label for="deleted_items_expiration_days">
          Remember items that were deleted on this computer for
          <input type="number" id="deleted_items_expiration_days"
                  v-model="deleted_items_expiration_days" min="1">
          days
        </label></li>
      </ul>
    </li>
  </ul>

  <hr>

  <h4>Tab and Memory Management (This Browser)</h4>
  <ul>
    <li>
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
    </li>
  </ul>
</main>
</template>

<script lang="ts">
import launch from './launch-vue';
import Vue from 'vue';

import * as Options from './model/options';

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

const Main = Vue.extend({
    props: {sync: Object, local: Object},
    computed: options(),
});
export default Main;

launch(Main, async() => {
    const opts = new Options.Model(await Options.live_source());
    (<any>globalThis).model = opts;
    return {
        propsData: Vue.observable({
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
