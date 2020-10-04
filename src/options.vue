<template>
<div>
  <label for="meta_show_advanced"><div class="advanced">
      <input type="checkbox" id="meta_show_advanced"
             v-model="meta_show_advanced" />
      Show advanced settings
  </div></label>

  <hr>

  <h4>Tab Stash Behavior (All Synced Browsers)</h4>
  <ul>
    <li class="synced">When saving tabs to the stash:</li>
    <ul>
      <label for="open_stash_in_sidebar"><li>
          <input type="radio" name="open_stash_in" id="open_stash_in_sidebar"
                 v-model="open_stash_in" value="sidebar" />
          Automatically show your stashed tabs in the sidebar
      </li></label>
      <label for="open_stash_in_tab"><li>
          <input type="radio" name="open_stash_in" id="open_stash_in_tab"
                 v-model="open_stash_in" value="tab" />
          Automatically show your stashed tabs in a new tab
      </li></label>
      <label for="open_stash_in_none"><li>
          <input type="radio" name="open_stash_in" id="open_stash_in_none"
                 v-model="open_stash_in" value="none" />
          Don't automatically show the stash
      </li></label>
    </ul>

    <li v-if="meta_show_advanced" class="advanced">
      <div>When stashing a single tab:</div>
      <ul>
        <li title="If the top-most stash has a name, or is older than this, a new, unnamed stash will be created instead.">
          <label for="new_folder_timeout_min">
            Append to the top-most stash only if it was created in the last
            <input type="number" id="new_folder_timeout_min"
                   v-model="new_folder_timeout_min" min="0">
            minutes
          </label>
        </li>
      </ul>
    </li>
  </ul>

  <hr>

  <h4 title="Options in this section are stored only on this computer.">Tab and Memory Management (This Browser)</h4>
  <ul>
    <li>Once a tab has been stashed:</li>
    <ul>
      <label for="after_stashing_tab_hide">
        <li title="Hidden tabs that are still loaded can be restored instantly. They also preserve anything you had entered into the tab and its history (e.g. Back button).">
          <input type="radio"
                 name="after_stashing_tab" id="after_stashing_tab_hide"
                 v-model="after_stashing_tab" value="hide" />
          Hide the tab and keep it loaded in the background
        </li>
      </label>
      <ul :class="{disabled: after_stashing_tab !== 'hide'}">
        <label for="autodiscard_hidden_tabs">
          <li title="Monitors the total number of tabs in your browser, and if you have a lot of tabs open, unloads hidden tabs that haven't been used recently. This option significantly reduces memory usage and is recommended for most users.">
            <input type="checkbox"
                   name="autodiscard_hidden_tabs" id="autodiscard_hidden_tabs"
                   :disabled="after_stashing_tab !== 'hide'"
                   v-model="autodiscard_hidden_tabs" />
            Automatically unload hidden tabs that haven't been used in a while
          </li>
        </label>
        <ul v-if="meta_show_advanced"
            :class="{advanced: true,
                    disabled: after_stashing_tab !== 'hide'
                           || ! autodiscard_hidden_tabs}">
          <label for="autodiscard_interval_min"><li>
              Check for old hidden tabs every
              <input type="number" id="autodiscard_interval_min"
                     :disabled="after_stashing_tab !== 'hide'
                                || ! autodiscard_hidden_tabs"
                     v-model="autodiscard_interval_min" min="1">
              minutes
          </li></label>
          <label for="autodiscard_min_keep_tabs"><li>
              Keep at least
              <input type="number" id="autodiscard_min_keep_tabs"
                     :disabled="after_stashing_tab !== 'hide'
                                || ! autodiscard_hidden_tabs"
                     v-model="autodiscard_min_keep_tabs" min="0">
              hidden and visible tabs loaded at all times
          </li></label>
          <label for="autodiscard_target_age_min"><li>
              Keep the oldest tabs loaded for at least
              <input type="number" id="autodiscard_target_age_min"
                     :disabled="after_stashing_tab !== 'hide'
                                || ! autodiscard_hidden_tabs"
                     v-model="autodiscard_target_age_min" min="1">
              minutes, but...
          </li></label>
          <label for="autodiscard_target_tab_count"><li>
              ...unload tabs more aggressively if there are more than
              <input type="number" id="autodiscard_target_tab_count"
                     :disabled="after_stashing_tab !== 'hide'
                                || ! autodiscard_hidden_tabs"
                     v-model="autodiscard_target_tab_count"
                     :min="autodiscard_min_keep_tabs">
              tabs loaded
          </li></label>
        </ul>
      </ul>
      <label for="after_stashing_tab_hide_discard">
        <li title="Hidden tabs that are unloaded can be restored very quickly, and usually without a network connection. They also preserve browsing history (e.g. Back button). However, depending on the website, you may lose anything you had entered into the tab that isn't already saved. Uses less memory.">
          <input type="radio"
                 name="after_stashing_tab" id="after_stashing_tab_hide_discard"
                 v-model="after_stashing_tab" value="hide_discard" />
          Hide the tab and immediately unload it
        </li>
      </label>
      <label for="after_stashing_tab_close">
        <li title="Uses the least amount of memory and takes the longest to restore, because tab contents may need to be fetched over the network. This option will cause the browser to forget anything you had entered into the tab, as well as the tab's browsing history (e.g. Back button).">
          <input type="radio"
                 name="after_stashing_tab" id="after_stashing_tab_close"
                 v-model="after_stashing_tab" value="close" />
          Close the tab immediately
        </li>
      </label>
    </ul>
  </ul>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import launch from './launch-vue';

import Options from './options-model';

const prop = (area: string, name: string) => ({
    get: function(this: any) { return this[area][name]; },
    set: function(this: any, v: any) {
        this[area].set({[name]: v}).catch(console.log);
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

launch(Main, {sync: Options.sync(), local: Options.local()});
</script>

<style>
</style>
