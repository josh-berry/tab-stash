<template>
  <main>
    <transition-group
      tag="aside"
      class="notification-overlay"
      appear
      name="notification"
    >
      <Notification v-if="copied" @dismiss="closeNotif">Copied</Notification>
    </transition-group>

    <div class="icon-warning" />

    <h2 v-if="protocol === 'file:'">Restoring a Local File</h2>
    <h2 v-else>Suspicious Stashed Tab</h2>

    <p v-if="protocol === 'file:'">
      For security reasons, your browser won't allow Tab Stash to restore tabs
      that show files on your computer without your intervention.
    </p>

    <p v-else>
      For security reasons, your browser won't allow Tab Stash to restore
      privileged tabs without your intervention.
    </p>

    <p>
      <strong>Please make sure this URL looks right.</strong> If it looks okay,
      you can restore the tab by copying and pasting the URL into the address
      bar:
    </p>

    <a ref="url" class="unsafe-url" :href="url" @click.prevent.stop="copy">{{
      url
    }}</a>
  </main>
</template>

<script lang="ts">
import {defineComponent} from "vue";

import {required} from "../util";

import Notification from "../components/notification.vue";

export default defineComponent({
  components: {Notification},

  props: {
    url: required(String),
  },

  data: () => ({
    copied: undefined as ReturnType<typeof setTimeout> | undefined,
  }),

  computed: {
    protocol(): string {
      try {
        return new URL(this.url).protocol;
      } catch (e) {
        return "";
      }
    },
  },

  methods: {
    copy() {
      const r = document.createRange();
      r.selectNodeContents(<Element>this.$refs.url);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(r);
      document.execCommand("copy");
      window.getSelection()!.removeAllRanges();

      clearTimeout(this.copied);
      this.copied = setTimeout(() => this.closeNotif(), 3000);
    },

    closeNotif() {
      clearTimeout(this.copied);
      this.copied = undefined;
    },
  },
});
</script>
