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
        {{ $t('showAdvancedSettings') }}
      </label>
    </section>

    <section>
      <button
        v-if="local.hide_crash_reports_until ?? 0 > Date.now()"
        @click.stop="showCrashReports"
      >
        {{ $t('stopHidingCrashReports') }}
      </button>
    </section>

    <hr />

    <h4>{{ $t('behaviorTitle') }}</h4>

    <section>
      <label>{{ $t('whenToolbarClicked') }}</label>
      <ul>
        <li>
          <select id="browser_action_stash" v-model="sync.browser_action_stash">
            <option :disabled="!model.canBrowserActionStash('all')" value="all">
              {{ $t('stashAllTabs') }}
            </option>
            <option
              :disabled="!model.canBrowserActionStash('single')"
              value="single"
            >
              {{ $t('stashActiveTab') }}
            </option>
            <option
              :disabled="!model.canBrowserActionStash('none')"
              value="none"
            >
              {{ $t('dontStashTabs') }}
            </option>
          </select>
          {{ $t('and') }}
          <select id="browser_action_show" v-model="sync.browser_action_show">
            <option
              v-if="model.hasSidebar()"
              :disabled="!model.canBrowserActionShow('sidebar')"
              value="sidebar"
            >
              {{ $t('showInSidebar') }}
            </option>
            <option :disabled="!model.canBrowserActionShow('tab')" value="tab">
              {{ $t('showInTab') }}
            </option>
            <option
              :disabled="!model.canBrowserActionShow('popup')"
              value="popup"
            >
              {{ $t('showInPopup') }}
            </option>
            <option
              :disabled="!model.canBrowserActionShow('none')"
              value="none"
            >
              {{ $t('dontShowStash') }}
            </option>
          </select>
        </li>
      </ul>
    </section>

    <section>
      <label>{{ $t('whenStashingFromMenu') }}</label>
      <ul>
        <li v-if="model.hasSidebar()">
          <label for="open_stash_in_sidebar">
            <input
              type="radio"
              name="open_stash_in"
              id="open_stash_in_sidebar"
              v-model="sync.open_stash_in"
              value="sidebar"
            />
            {{ $t('showStashInSidebar') }}
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
            {{ $t('showStashInTab') }}
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
            {{ $t('dontShowStashOption') }}
          </label>
        </li>
      </ul>
    </section>

    <section class="advanced">
      <label>{{ $t('whenStashingSingleTab') }}</label>
      <ul>
        <li>
          <label
            for="new_folder_timeout_min"
            :title="$t('newFolderTimeoutTitle')"
          >
            {{ $t('appendToTopGroupPrefix') }}
            <input
              type="number"
              id="new_folder_timeout_min"
              v-model="sync.new_folder_timeout_min"
              min="0"
            />
            {{ $t('minutes') }}
          </label>
        </li>
      </ul>
    </section>

    <hr />

    <h4>{{ $t('appearanceTitle') }}</h4>

    <section class="two-col">
      <label for="ui_metrics">{{ $t('spacingAndFonts') }}</label>
      <select id="ui_metrics" v-model="sync.ui_metrics">
        <option value="normal">{{ $t('themeNormal') }}</option>
        <option value="compact">{{ $t('themeCompact') }}</option>
      </select>

      <label for="ui_theme">{{ $t('themeLabel') }}</label>
      <select id="ui_theme" v-model="sync.ui_theme">
        <option value="system">{{ $t('themeSystem') }}</option>
        <option value="light">{{ $t('themeLight') }}</option>
        <option value="dark">{{ $t('themeDark') }}</option>
      </select>

      <label for="show_open_tabs">{{ $t('showWhichOpenTabs') }}</label>
      <select
        id="show_open_tabs"
        v-model="sync.show_open_tabs"
        :title="$t('showOpenTabsTitle')"
      >
        <option value="unstashed">{{ $t('unstashedTabsOnly') }}</option>
        <option value="all">{{ $t('stashedAndUnstashedTabs') }}</option>
      </select>

      <label for="show_new_folders">{{ $t('showNewGroups') }}</label>
      <select id="show_new_folders" v-model="sync.show_new_folders">
        <option value="expanded">{{ $t('expanded') }}</option>
        <option value="collapsed">{{ $t('collapsed') }}</option>
      </select>
    </section>

    <hr />

    <h4>{{ $t('privacyTitle') }}</h4>

    <section>
      <label>{{ $t('whenDeletingItems') }}</label>
      <ul>
        <li>
          <label for="deleted_items_expiration_days">
            {{ $t('rememberDeletedItemsPrefix') }}
            <input
              type="number"
              id="deleted_items_expiration_days"
              v-model="sync.deleted_items_expiration_days"
              min="1"
            />
            {{ $t('days') }}
          </label>
        </li>
      </ul>
    </section>

    <hr />

    <h4>{{ $t('tabMemoryTitle') }}</h4>

    <section>
      <label>{{ $t('onceTabStashed') }}</label>
      <ul>
        <li>
          <label
            for="after_stashing_tab_hide"
            :title="$t('afterStashingTabHideTitle')"
          >
            <input
              type="radio"
              name="after_stashing_tab"
              id="after_stashing_tab_hide"
              v-model="local.after_stashing_tab"
              value="hide"
            />
            {{ $t('hideKeepLoaded') }}
          </label>
          <ul :class="{disabled: local.after_stashing_tab !== 'hide'}">
            <li>
              <label
                for="autodiscard_hidden_tabs"
                :title="$t('autoDiscardHiddenTitle')"
              >
                <input
                  type="checkbox"
                  name="autodiscard_hidden_tabs"
                  id="autodiscard_hidden_tabs"
                  :disabled="local.after_stashing_tab !== 'hide'"
                  v-model="local.autodiscard_hidden_tabs"
                />
                {{ $t('autoUnloadHidden') }}
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
                    {{ $t('checkHiddenEvery') }}
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
                    {{ $t('minutes') }}
                  </label>
                </li>
                <li>
                  <label for="autodiscard_min_keep_tabs">
                    {{ $t('keepAtLeast') }}
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
                    {{ $t('hiddenVisibleLoaded') }}
                  </label>
                </li>
                <li>
                  <label for="autodiscard_target_age_min">
                    {{ $t('keepOldestLoaded') }}
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
                    {{ $t('minutesBut') }}
                  </label>
                </li>
                <li>
                  <label for="autodiscard_target_tab_count">
                    {{ $t('unloadMoreAggressively') }}
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
                    {{ $t('tabsLoaded') }}
                  </label>
                </li>
              </ul>
            </li>
          </ul>
        </li>
        <li>
          <label
            for="after_stashing_tab_hide_discard"
            :title="$t('afterStashingTabHideDiscardTitle')"
          >
            <input
              type="radio"
              name="after_stashing_tab"
              id="after_stashing_tab_hide_discard"
              v-model="local.after_stashing_tab"
              value="hide_discard"
            />
            {{ $t('hideImmediatelyUnload') }}
          </label>
        </li>
        <li>
          <label
            for="after_stashing_tab_close"
            :title="$t('afterStashingTabCloseTitle')"
          >
            <input
              type="radio"
              name="after_stashing_tab"
              id="after_stashing_tab_close"
              v-model="local.after_stashing_tab"
              value="close"
            />
            {{ $t('closeTabImmediately') }}
          </label>
        </li>
      </ul>
    </section>

    <section>
      <label>{{ $t('whenOpeningFromStash') }}</label>
      <ul>
        <li>
          <label for="load_tabs_on_restore_immediately">
            <input
              type="radio"
              id="load_tabs_on_restore_immediately"
              v-model="local.load_tabs_on_restore"
              value="immediately"
            />
            {{ $t('loadImmediately') }}
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
            {{ $t('loadLazily') }}
          </label>
        </li>
      </ul>
    </section>

    <hr />

    <h4>{{ $t('confirmationsTitle') }}</h4>

    <section>
      <li>
        <label for="confirm_close_open_tabs">
          <input
            type="checkbox"
            id="confirm_close_open_tabs"
            v-model="local.confirm_close_open_tabs"
          />
          {{ $t('confirmCloseTabs') }}
        </label>
      </li>
    </section>

    <hr v-if="sync.meta_show_advanced" />

    <section class="advanced">
      <h4>{{ $t('experimentalFeaturesTitle') }}</h4>

      <p>
        <em
          ><b>{{ $t('warningLabel') }}</b> {{ $t('experimentalFeaturesWarning') }}</em
        >
      </p>

      <p>
        <em
          >{{ $t('experimentalFeaturesFeedback') }}</em
        >
      </p>

      <FeatureFlag
        name="ff_restore_closed_tabs"
        v-model="local.ff_restore_closed_tabs"
        :default_value="local_def().ff_restore_closed_tabs.default"
        :issue="200"
      >
        <template v-slot:summary>{{ $t('restoreRecentlyClosedTabs') }}</template>
        {{ $t('restoreRecentlyClosedTabsDesc') }}
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

import * as Options from "../model/options.js";
import {required, $t} from "../util/index.js";
import {logErrorsFrom} from "../util/oops.js";

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
    $t,

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
