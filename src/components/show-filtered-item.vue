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
    <span class="forest-title status-text">{{ count }} filtered</span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  visible: boolean;
  count: number;
}>();

const emit = defineEmits<{
  (ev: "update:visible", visible: boolean): void;
}>();
</script>
