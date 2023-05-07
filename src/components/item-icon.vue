<template>
  <component
    :is="selectable ? 'a' : 'span'"
    :class="{'item-icon': true, selectable, selected}"
    :title="selectable ? (selected ? 'Deselect' : 'Select') : undefined"
  >
    <img
      v-if="src"
      :src="src"
      :srcset="src + ' 2x'"
      referrerpolicy="no-referrer"
      alt=""
    />
    <span v-else :class="{icon: true, [`icon-${defaultIcon}`]: true}" />
  </component>
</template>

<script setup lang="ts">
defineProps<{
  defaultIcon: string;
  src?: string;
  selectable?: boolean;
  selected?: boolean;
}>();
</script>
