<template>
  <component :is="is || 'a'" class="icon">
    <img
      v-if="props.src"
      :src="props.src"
      :srcset="props.src + ' 2x'"
      referrerpolicy="no-referrer"
      alt=""
    />
  </component>
</template>

<script setup lang="ts">
const props = defineProps<{is?: string; src?: string}>();
</script>
