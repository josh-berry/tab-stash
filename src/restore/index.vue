<template>
  <main>
    <transition-group
      tag="aside"
      class="notification-overlay"
      appear
      name="notification"
    >
      <Notification v-if="copied" @dismiss="closeNotif">{{
        $t("copiedNotification")
      }}</Notification>
    </transition-group>

    <div class="flat-heading-icon icon-warning" />

    <h1 v-if="protocol === 'file:'">{{ $t("restoreLocalFileTitle") }}</h1>
    <h1 v-else>{{ $t("restoreSuspiciousTitle") }}</h1>

    <p v-if="protocol === 'file:'">
      {{ $t("restoreLocalFileWarning") }}
    </p>

    <p v-else>
      {{ $t("restorePrivilegedWarning") }}
    </p>

    <p>
      <strong>{{ $t("restoreURLWarningBold") }}</strong>
      {{ $t("restoreURLWarningText") }}
    </p>

    <a ref="url" class="unsafe-url" :href="url" @click.prevent.stop="copy">{{
      url
    }}</a>
  </main>
</template>

<script lang="ts">
import {defineComponent} from "vue";

import {required, $t} from "../util/index.js";

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
    $t,
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
