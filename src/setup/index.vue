<template>
  <main>
    <!-- <div class="flat-heading-icon icon-logo" /> -->

    <h1>{{ $t("welcomeTitle") }}</h1>

    <p>
      {{ $t("welcomeIntro") }}
    </p>

    <section>
      <hr />
      <p>
        <span class="icon icon-logo" />
        {{ $t("setupWhatToSave") }}
      </p>

      <p>
        <label :class="{disabled: !options.canBrowserActionStash('all')}"
          ><input
            type="radio"
            name="browser_action_stash"
            value="all"
            v-model="browser_action_stash"
            :disabled="!options.canBrowserActionStash('all')"
          />
          {{ $t("setupSaveAllOpen") }}</label
        >
      </p>
      <p>
        <label :class="{disabled: !options.canBrowserActionStash('single')}"
          ><input
            type="radio"
            name="browser_action_stash"
            value="single"
            v-model="browser_action_stash"
            :disabled="!options.canBrowserActionStash('single')"
          />
          {{ $t("setupSaveActive") }}</label
        >
      </p>
      <p
        v-if="
          !options.canBrowserActionStash('single') ||
          !options.canBrowserActionStash('all')
        "
        class="status-text note"
      >
        {{ $t("setupCantShowPopupNote") }}
      </p>
      <p>
        <label :class="{disabled: !options.canBrowserActionStash('none')}"
          ><input
            type="radio"
            name="browser_action_stash"
            value="none"
            v-model="browser_action_stash"
            :disabled="!options.canBrowserActionStash('none')"
          />
          {{ $t("setupDontSaveAnything") }}</label
        >
      </p>
      <p v-if="!options.canBrowserActionStash('none')" class="status-text note">
        {{ $t("setupChooseShowOptionNote") }}
      </p>
    </section>

    <section v-if="show_browser_action_show" ref="$browser_action_show">
      <hr />
      <p>
        <span class="icon icon-logo" />
        {{ $t("setupWhatToSee") }}
      </p>

      <p>
        <label
          v-if="options.hasSidebar()"
          :class="{disabled: !options.canBrowserActionShow('sidebar')}"
          ><input
            type="radio"
            name="browser_action_show"
            value="sidebar"
            v-model="browser_action_show"
            :disabled="!options.canBrowserActionShow('sidebar')"
          />
          {{ $t("setupShowSidebar") }}</label
        >
      </p>
      <p>
        <label :class="{disabled: !options.canBrowserActionShow('tab')}"
          ><input
            type="radio"
            name="browser_action_show"
            value="tab"
            v-model="browser_action_show"
            :disabled="!options.canBrowserActionShow('tab')"
          />
          {{ $t("setupShowTab") }}</label
        >
      </p>
      <p>
        <label :class="{disabled: !options.canBrowserActionShow('popup')}"
          ><input
            type="radio"
            name="browser_action_show"
            value="popup"
            v-model="browser_action_show"
            :disabled="!options.canBrowserActionShow('popup')"
          />
          {{ $t("setupShowPopup") }}</label
        >
      </p>
      <p v-if="!options.canBrowserActionShow('popup')" class="status-text note">
        {{ $t("setupPopupNote") }}
      </p>
      <p>
        <label :class="{disabled: !options.canBrowserActionShow('none')}"
          ><input
            type="radio"
            name="browser_action_show"
            value="none"
            v-model="browser_action_show"
            :disabled="!options.canBrowserActionShow('none')"
          />
          {{ $t("setupDontShowAnything") }}</label
        >
      </p>
      <p v-if="!options.canBrowserActionShow('none')" class="status-text note">
        {{ $t("setupChooseSaveOptionNote") }}
      </p>
    </section>

    <section v-if="show_open_stash_in" ref="$open_stash_in">
      <hr />
      <p>
        <span class="icon icon-stash-one" />
        {{ $t("setupAddressBarContextStash") }}
      </p>

      <p v-if="options.hasSidebar()">
        <label
          ><input
            type="radio"
            name="open_stash_in"
            value="sidebar"
            v-model="open_stash_in"
          />{{ $t("setupShowSidebar") }}</label
        >
      </p>
      <p>
        <label
          ><input
            type="radio"
            name="open_stash_in"
            value="tab"
            v-model="open_stash_in"
          />{{ $t("setupShowTab") }}</label
        >
      </p>
      <p>
        <label
          ><input
            type="radio"
            name="open_stash_in"
            value="none"
            v-model="open_stash_in"
          />{{ $t("setupDontShowAnything") }}</label
        >
      </p>
    </section>

    <section v-if="show_done" ref="$done">
      <hr />

      <p>{{ $t("setupAllSetNote") }}</p>
      <p>{{ $t("setupThanksFooter") }}</p>
    </section>
  </main>
</template>

<script lang="ts">
import {computed, ref, watch, type WritableComputedRef} from "vue";

import * as Options from "../model/options.js";
import the from "../globals-ui.js";

function computedOption<K extends keyof Options.SyncState>(
  name: K,
): WritableComputedRef<Options.SyncState[K]> {
  return computed<Options.SyncState[K]>({
    get() {
      return the.model.options.sync.state[name];
    },
    set(v) {
      the.model.options.sync.set({[name]: v}).catch(console.error);
    },
  });
}
</script>

<script setup lang="ts">
import {$t} from "../util/index.js";

defineProps<{}>();

const options = the.model.options;

const browser_action_stash = computedOption("browser_action_stash");
const browser_action_show = computedOption("browser_action_show");
const open_stash_in = computedOption("open_stash_in");

// When to show each new section, in order
const show_browser_action_show = computed(() => !!browser_action_stash.value);
const show_open_stash_in = computed(
  () => show_browser_action_show.value && !!browser_action_show.value,
);
const show_done = computed(
  () => show_open_stash_in.value && !!open_stash_in.value,
);

// Refs to each section; we can use these to scroll the section into view once
// it appears.
const $browser_action_show = ref(undefined as HTMLElement | undefined);
const $open_stash_in = ref(undefined as HTMLElement | undefined);
const $done = ref(undefined as HTMLElement | undefined);

const scroll_into_view = (el?: HTMLElement) => {
  if (el) el.scrollIntoView({behavior: "smooth"});
};

watch($browser_action_show, scroll_into_view);
watch($open_stash_in, scroll_into_view);
watch($done, scroll_into_view);
</script>
