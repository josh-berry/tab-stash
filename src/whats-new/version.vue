<template>
  <li>
    <div
      :class="{
        'forest-item': true,
        'action-container': true,
        collapsed: is_collapsed,
      }"
    >
      <span class="forest-title">Version {{ v }}</span>
      <Button
        :class="{
          'forest-collapse': true,
          action: true,
          collapse: !is_collapsed,
          expand: is_collapsed,
        }"
        @action="collapsed = !is_collapsed"
      />
    </div>
    <ul
      :class="{
        'forest-children': true,
        'version-changes': true,
        collapsed: is_collapsed,
      }"
    >
      <slot />
    </ul>
  </li>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import {cmpVersions, required} from "../util";

import Button from "../components/button.vue";

export default defineComponent({
  components: {Button},

  props: {v: required(String)},
  inject: ["last_notified_version"],
  data: () => ({collapsed: undefined as boolean | undefined}),

  computed: {
    is_collapsed(): boolean {
      const version = (<any>this).last_notified_version as string;

      if (this.collapsed !== undefined) return this.collapsed;
      return version !== undefined && cmpVersions(this.v, version) <= 0;
    },
  },
});
</script>

<style></style>
