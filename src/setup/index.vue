<template>
  <main>
    <!-- <div class="flat-heading-icon icon-logo" /> -->

    <h1>Welcome to Tab Stash!</h1>

    <p>
      Hi! Let's go through a couple quick questions to get you started. Don't
      worry—you can change your answers later in Tab Stash's options.
    </p>

    <section>
      <hr />
      <p>
        <span class="icon icon-logo" />
        What would you like to <strong>save</strong> when you click the toolbar
        button?
      </p>

      <p>
        <label :class="{disabled: !the.options.canBrowserActionStash('all')}"
          ><input
            type="radio"
            name="browser_action_stash"
            value="all"
            v-model="browser_action_stash"
            :disabled="!the.options.canBrowserActionStash('all')"
          />
          Save all open tabs to the stash</label
        >
      </p>
      <p>
        <label :class="{disabled: !the.options.canBrowserActionStash('single')}"
          ><input
            type="radio"
            name="browser_action_stash"
            value="single"
            v-model="browser_action_stash"
            :disabled="!the.options.canBrowserActionStash('single')"
          />
          Save the active tab to the stash</label
        >
      </p>
      <p
        v-if="
          !the.options.canBrowserActionStash('single') ||
          !the.options.canBrowserActionStash('all')
        "
        class="status-text note"
      >
        You can't show the popup and save tabs at the same time.
      </p>
      <p>
        <label :class="{disabled: !the.options.canBrowserActionStash('none')}"
          ><input
            type="radio"
            name="browser_action_stash"
            value="none"
            v-model="browser_action_stash"
            :disabled="!the.options.canBrowserActionStash('none')"
          />
          Don't save anything to the stash</label
        >
      </p>
      <p
        v-if="!the.options.canBrowserActionStash('none')"
        class="status-text note"
      >
        Choose a different "Show..." option to enable this
      </p>
    </section>

    <section v-if="browser_action_stash">
      <hr />
      <p>
        <span class="icon icon-logo" />
        What would you like to <strong>see</strong> when you click the toolbar
        button?
      </p>

      <p>
        <label
          v-if="the.options.hasSidebar()"
          :class="{disabled: !the.options.canBrowserActionShow('sidebar')}"
          ><input
            type="radio"
            name="browser_action_show"
            value="sidebar"
            v-model="browser_action_show"
            :disabled="!the.options.canBrowserActionShow('sidebar')"
          />
          Show my stashed tabs in the sidebar</label
        >
      </p>
      <p>
        <label :class="{disabled: !the.options.canBrowserActionShow('tab')}"
          ><input
            type="radio"
            name="browser_action_show"
            value="tab"
            v-model="browser_action_show"
            :disabled="!the.options.canBrowserActionShow('tab')"
          />
          Show my stashed tabs in a tab</label
        >
      </p>
      <p>
        <label :class="{disabled: !the.options.canBrowserActionShow('popup')}"
          ><input
            type="radio"
            name="browser_action_show"
            value="popup"
            v-model="browser_action_show"
            :disabled="!the.options.canBrowserActionShow('popup')"
          />
          Show my stashed tabs in a popup</label
        >
      </p>
      <p
        v-if="!the.options.canBrowserActionShow('popup')"
        class="status-text note"
      >
        To use the popup, choose "Don't save anything to the stash"
      </p>
      <p>
        <label :class="{disabled: !the.options.canBrowserActionShow('none')}"
          ><input
            type="radio"
            name="browser_action_show"
            value="none"
            v-model="browser_action_show"
            :disabled="!the.options.canBrowserActionShow('none')"
          />
          Don't show me anything</label
        >
      </p>
      <p
        v-if="!the.options.canBrowserActionShow('none')"
        class="status-text note"
      >
        Choose a different "Save..." option to enable this
      </p>
    </section>

    <section v-if="browser_action_stash && browser_action_show">
      <hr />
      <p>
        <span class="icon icon-stash-one" />

        If you stash a tab using the address bar or context menu, what do you
        want to see?
      </p>

      <p v-if="the.options.hasSidebar()">
        <label
          ><input
            type="radio"
            name="open_stash_in"
            value="sidebar"
            v-model="open_stash_in"
          />Show my stashed tabs in the sidebar</label
        >
      </p>
      <p>
        <label
          ><input
            type="radio"
            name="open_stash_in"
            value="tab"
            v-model="open_stash_in"
          />Show my stashed tabs in a tab</label
        >
      </p>
      <p>
        <label
          ><input
            type="radio"
            name="open_stash_in"
            value="none"
            v-model="open_stash_in"
          />Don't show me anything</label
        >
      </p>
    </section>

    <section
      v-if="browser_action_stash && browser_action_show && open_stash_in"
    >
      <hr />

      <p>You're all set! You can close this tab.</p>
      <p>Thanks for trying out Tab Stash. I hope you enjoy it! —Josh</p>
    </section>
  </main>
</template>

<script lang="ts">
import {computed, type WritableComputedRef} from "vue";

import * as Options from "../model/options";
import the from "./globals";

function computedOption<K extends keyof Options.SyncState>(
  name: K,
): WritableComputedRef<Options.SyncState[K]> {
  return computed<Options.SyncState[K]>({
    get() {
      return the.options.sync.state[name];
    },
    set(v) {
      the.options.sync.set({[name]: v}).catch(console.error);
    },
  });
}
</script>

<script setup lang="ts">
defineProps<{}>();

const browser_action_stash = computedOption("browser_action_stash");
const browser_action_show = computedOption("browser_action_show");
const open_stash_in = computedOption("open_stash_in");
</script>
