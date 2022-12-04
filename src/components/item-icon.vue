<template>
  <a class="item-icon">
    <img
      v-if="props.src"
      :src="props.src"
      :srcset="props.src + ' 2x'"
      referrerpolicy="no-referrer"
      alt=""
    />
  </a>
</template>

<script setup lang="ts">
const props = defineProps<{src?: string}>();
</script>
