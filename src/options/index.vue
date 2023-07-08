<template>
  <main :class="{'show-advanced': sync.meta_show_advanced}">
    <transition-group
      tag="aside"
      class="notification-overlay"
      appear
      name="notification"
    >
      <OopsNotification key="oops" v-if="showCrashReport" />
    </transition-group>

    <section class="advanced show-advanced">
      <label for="meta_show_advanced">
        <input
          type="checkbox"
          id="meta_show_advanced"
          v-model="sync.meta_show_advanced"
        />
        Show advanced settings
      </label>
    </section>

    <section>
      <button
        v-if="local.hide_crash_reports_until ?? 0 > Date.now()"
        @click.stop="showCrashReports"
      >
        Stop Hiding Crash Reports
      </button>
    </section>

    <hr />

    <h4>Tab Stash Behavior (All Synced Browsers)</h4>

    <section>
      <label>When the toolbar button is clicked:</label>
      <ul>
        <li>
          <select id="browser_action_stash" v-model="sync.browser_action_stash">
            <option
              :disabled="sync.browser_action_show === 'popup'"
              value="all"
            >
              Stash all (or selected) tabs
            </option>
            <option
              :disabled="sync.browser_action_show === 'popup'"
              value="single"
            >
              Stash the active tab
            </option>
            <option
              :disabled="sync.browser_action_show === 'none'"
              value="none"
            >
              Don't stash any tabs
            </option>
          </select>
          and
          <select id="browser_action_show" v-model="sync.browser_action_show">
            <option v-if="hasSidebar" value="sidebar">
              show the stash in the sidebar
            </option>
            <option value="tab">show the stash in a tab</option>
            <option
              :disabled="sync.browser_action_stash !== 'none'"
              value="popup"
            >
              show the stash in a popup
            </option>
            <option
              :disabled="sync.browser_action_stash === 'none'"
              value="none"
            >
              don't show the stash
            </option>
          </select>
        </li>
      </ul>
    </section>

    <section>
      <label>When stashing tabs from the context menu or address bar:</label>
      <ul>
        <li v-if="hasSidebar">
          <label for="open_stash_in_sidebar">
            <input
              type="radio"
              name="open_stash_in"
              id="open_stash_in_sidebar"
              v-model="sync.open_stash_in"
              value="sidebar"
            />
            Show the stash in the sidebar
          </label>
        </li>
        <li>
          <label for="open_stash_in_tab">
            <input
              type="radio"
              name="open_stash_in"
              id="open_stash_in_tab"
              v-model="sync.open_stash_in"
              value="tab"
            />
            Show the stash in a tab
          </label>
        </li>
        <li>
          <label for="open_stash_in_none">
            <input
              type="radio"
              name="open_stash_in"
              id="open_stash_in_none"
              v-model="sync.open_stash_in"
              value="none"
            />
            Don't show the stash
          </label>
        </li>
      </ul>
    </section>

    <section class="advanced">
      <label>When stashing a single tab:</label>
      <ul>
        <li>
          <label
            for="new_folder_timeout_min"
            title="If the top-most stash has a name, or is older than this, a new, unnamed stash will be created instead."
          >
            Append to the top-most stash only if it was created in the last
            <input
              type="number"
              id="new_folder_timeout_min"
              v-model="sync.new_folder_timeout_min"
              min="0"
            />
            minutes
          </label>
        </li>
      </ul>
    </section>

    <hr />

    <h4>Appearance (All Synced Browsers)</h4>

    <section class="two-col">
      <label for="ui_metrics">Spacing and fonts:</label>
      <select id="ui_metrics" v-model="sync.ui_metrics">
        <option value="normal">Normal</option>
        <option value="compact">Compact</option>
      </select>

      <label for="ui_theme">Theme:</label>
      <select id="ui_theme" v-model="sync.ui_theme">
        <option value="system">Same as operating system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>

      <label for="show_open_tabs">Show which open tabs:</label>
      <select
        id="show_open_tabs"
        v-model="sync.show_open_tabs"
        :title="
          `Click on the &quot;Open Tabs&quot; or ` +
          `&quot;Unstashed Tabs&quot; title to toggle between these ` +
          `options. Note that pinned tabs are never shown.`
        "
      >
        <option value="unstashed">Unstashed tabs only</option>
        <option value="all">Stashed and unstashed tabs</option>
      </select>

      <label for="show_new_folders">Show new tab groups:</label>
      <select id="show_new_folders" v-model="sync.show_new_folders">
        <option value="expanded">Expanded</option>
        <option value="collapsed">Collapsed</option>
      </select>
    </section>

    <hr />

    <h4>Privacy (All Synced Browsers)</h4>

    <section>
      <label>When deleting items from your stash:</label>
      <ul>
        <li>
          <label for="deleted_items_expiration_days">
            Remember items that were deleted on this computer for
            <input
              type="number"
              id="deleted_items_expiration_days"
              v-model="sync.deleted_items_expiration_days"
              min="1"
            />
            days
          </label>
        </li>
      </ul>
    </section>

    <hr />

    <h4>Tab and Memory Management (This Browser)</h4>

    <section>
      <label>Once a tab has been stashed:</label>
      <ul>
        <li>
          <label
            for="after_stashing_tab_hide"
            title="Hidden tabs that are still loaded can be restored instantly. They also preserve anything you had entered into the tab and its history (e.g. Back button)."
          >
            <input
              type="radio"
              name="after_stashing_tab"
              id="after_stashing_tab_hide"
              v-model="local.after_stashing_tab"
              value="hide"
            />
            Hide the tab and keep it loaded in the background
          </label>
          <ul :class="{disabled: local.after_stashing_tab !== 'hide'}">
            <li>
              <label
                for="autodiscard_hidden_tabs"
                title="Monitors the total number of tabs in your browser, and if you have a lot of tabs open, unloads hidden tabs that haven't been used recently. This option significantly reduces memory usage and is recommended for most users."
              >
                <input
                  type="checkbox"
                  name="autodiscard_hidden_tabs"
                  id="autodiscard_hidden_tabs"
                  :disabled="local.after_stashing_tab !== 'hide'"
                  v-model="local.autodiscard_hidden_tabs"
                />
                Automatically unload hidden tabs that haven't been used in a
                while
              </label>
            </li>
            <li>
              <ul
                :class="{
                  advanced: true,
                  disabled:
                    local.after_stashing_tab !== 'hide' ||
                    !local.autodiscard_hidden_tabs,
                }"
              >
                <li>
                  <label for="autodiscard_interval_min">
                    Check for old hidden tabs every
                    <input
                      type="number"
                      id="autodiscard_interval_min"
                      :disabled="
                        local.after_stashing_tab !== 'hide' ||
                        !local.autodiscard_hidden_tabs
                      "
                      v-model="local.autodiscard_interval_min"
                      min="1"
                    />
                    minutes
                  </label>
                </li>
                <li>
                  <label for="autodiscard_min_keep_tabs">
                    Keep at least
                    <input
                      type="number"
                      id="autodiscard_min_keep_tabs"
                      :disabled="
                        local.after_stashing_tab !== 'hide' ||
                        !local.autodiscard_hidden_tabs
                      "
                      v-model="local.autodiscard_min_keep_tabs"
                      min="0"
                    />
                    hidden and visible tabs loaded at all times
                  </label>
                </li>
                <li>
                  <label for="autodiscard_target_age_min">
                    Keep the oldest tabs loaded for at least
                    <input
                      type="number"
                      id="autodiscard_target_age_min"
                      :disabled="
                        local.after_stashing_tab !== 'hide' ||
                        !local.autodiscard_hidden_tabs
                      "
                      v-model="local.autodiscard_target_age_min"
                      min="1"
                    />
                    minutes, but...
                  </label>
                </li>
                <li>
                  <label for="autodiscard_target_tab_count">
                    ...unload tabs more aggressively if there are more than
                    <input
                      type="number"
                      id="autodiscard_target_tab_count"
                      :disabled="
                        local.after_stashing_tab !== 'hide' ||
                        !local.autodiscard_hidden_tabs
                      "
                      v-model="local.autodiscard_target_tab_count"
                      :min="local.autodiscard_min_keep_tabs"
                    />
                    tabs loaded
                  </label>
                </li>
              </ul>
            </li>
          </ul>
        </li>
        <li>
          <label
            for="after_stashing_tab_hide_discard"
            title="Hidden tabs that are unloaded can be restored very quickly, and usually without a network connection. They also preserve browsing history (e.g. Back button). However, depending on the website, you may lose anything you had entered into the tab that isn't already saved. Uses less memory."
          >
            <input
              type="radio"
              name="after_stashing_tab"
              id="after_stashing_tab_hide_discard"
              v-model="local.after_stashing_tab"
              value="hide_discard"
            />
            Hide the tab and immediately unload it
          </label>
        </li>
        <li>
          <label
            for="after_stashing_tab_close"
            title="Uses the least amount of memory and takes the longest to restore, because tab contents may need to be fetched over the network. This option will cause the browser to forget anything you had entered into the tab, as well as the tab's browsing history (e.g. Back button)."
          >
            <input
              type="radio"
              name="after_stashing_tab"
              id="after_stashing_tab_close"
              v-model="local.after_stashing_tab"
              value="close"
            />
            Close the tab immediately
          </label>
        </li>
      </ul>
    </section>

    <section>
      <label>When opening tabs from the stash:</label>
      <ul>
        <li>
          <label for="load_tabs_on_restore_immediately">
            <input
              type="radio"
              id="load_tabs_on_restore_immediately"
              v-model="local.load_tabs_on_restore"
              value="immediately"
            />
            Load all opened tabs immediately
          </label>
        </li>
        <li>
          <label for="load_tabs_on_restore_lazily">
            <input
              type="radio"
              id="load_tabs_on_restore_lazily"
              v-model="local.load_tabs_on_restore"
              value="lazily"
            />
            Wait for a tab to be selected before loading it
          </label>
        </li>
      </ul>
    </section>

    <hr />

    <h4>Confirmations (This Browser)</h4>

    <section>
      <li>
        <label for="confirm_close_open_tabs">
          <input
            type="checkbox"
            id="confirm_close_open_tabs"
            v-model="local.confirm_close_open_tabs"
          />
          Confirm when closing a lot of open tabs
        </label>
      </li>
    </section>

    <hr v-if="sync.meta_show_advanced" />

    <section class="advanced">
      <h4>Experimental Features</h4>

      <p>
        <em
          ><b>WARNING:</b> Turning on experimental features may break Tab Stash
          or cause data loss! They are "experimental" because they are still in
          development and/or there may be known issues. Experimental features
          may change significantly or be removed entirely in future
          versions.</em
        >
      </p>

      <p>
        <em
          >To provide feedback or report a problem with a feature, leave a
          comment on the issue linked in [brackets] below.</em
        >
      </p>

      <FeatureFlag
        name="ff_restore_closed_tabs"
        v-model="local.ff_restore_closed_tabs"
        :default_value="local_def().ff_restore_closed_tabs.default"
        :issue="200"
      >
        <template v-slot:summary>Restore Recently-Closed Tabs</template>
        When restoring tabs, if a hidden tab isn't available, search for and
        re-open recently-closed tabs with matching URLs. (NOTE: This is known to
        occasionally restore incorrect tabs on certain versions of Firefox,
        check the linked issue for more details.)
      </FeatureFlag>
    </section>
  </main>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  type PropType,
  type WritableComputedRef,
} from "vue";

import * as Options from "../model/options";
import {required} from "../util";
import {logErrorsFrom} from "../util/oops";

import OopsNotification from "../components/oops-notification.vue";
import FeatureFlag from "./feature-flag.vue";

function prop<
  M extends Options.SyncModel | Options.LocalModel,
  N extends keyof M["state"],
>(model: M, name: N): WritableComputedRef<M["state"][N]> {
  return computed({
    get(): M["state"][N] {
      return model.state[name as keyof typeof model.state];
    },
    set(v: M["state"][N]) {
      logErrorsFrom(() => model.set({[name]: v}));
    },
  });
}

function options(model: Options.Model): {
  sync: Options.SyncState;
  local: Options.LocalState;
} {
  const ret = {sync: {} as any, local: {} as any};

  for (const k of Object.keys(Options.SYNC_DEF)) {
    ret.sync[k] = prop(model.sync, k as keyof Options.SyncState);
  }
  for (const k of Object.keys(Options.LOCAL_DEF)) {
    ret.local[k] = prop(model.local, k as keyof Options.LocalState);
  }

  return ret;
}

export default defineComponent({
  components: {FeatureFlag, OopsNotification},

  props: {
    hasSidebar: Boolean,
    model: required(Object as PropType<Options.Model>),
  },

  data() {
    return options(this.model);
  },

  computed: {
    showCrashReport(): boolean {
      return this.model.showCrashReport.value;
    },
  },

  watch: {
    browser_action_show(val: Options.ShowWhatOpt) {
      switch (val) {
        case "popup":
          logErrorsFrom(() =>
            this.model.sync.set({browser_action_stash: "none"}),
          );
          break;
        case "none":
          if (this.model.sync.state.browser_action_stash === "none") {
            logErrorsFrom(() =>
              this.model.sync.set({browser_action_stash: "single"}),
            );
          }
          break;
      }
    },

    browser_action_stash(val: Options.StashWhatOpt) {
      switch (val) {
        case "none":
          if (this.model.sync.state.browser_action_show === "none") {
            logErrorsFrom(() =>
              this.model.sync.set({browser_action_show: "tab"}),
            );
          }
          break;
        default:
          if (this.model.sync.state.browser_action_show === "popup") {
            logErrorsFrom(() =>
              this.model.sync.set({browser_action_show: "tab"}),
            );
          }
          break;
      }
    },
  },

  methods: {
    local_def() {
      return Options.LOCAL_DEF;
    },
    sync_def() {
      return Options.SYNC_DEF;
    },

    showCrashReports() {
      logErrorsFrom(() =>
        this.model.local.set({hide_crash_reports_until: undefined}),
      );
    },
  },
});
</script>

<style></style>
