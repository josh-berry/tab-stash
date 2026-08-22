<template>
  <div
    class="forest-item selectable"
    @click.prevent.stop="emit('update:visible', !props.visible)"
  >
    <span
      :class="{
        'forest-icon': true,
        'item-icon': true,
        'icon-filtered-visible': props.visible,
        'icon-filtered-hidden': !props.visible,
        'status-text': true,
      }"
      :aria-label="props.visible ? 'Showing' : 'Hiding'"
    />
    <span class="forest-title status-text">{{
      $t(props.label || "filteredCountBadge", [`${props.count}`])
    }}</span>
  </div>
</template>

<script lang="ts">
import {type MessageKey, $t} from "../util/i18n.js";
</script>

<script setup lang="ts">
const props = defineProps<{
  visible: boolean;
  count: number;
  label?: MessageKey;
}>();

const emit = defineEmits<{
  (ev: "update:visible", visible: boolean): void;
}>();
</script>
