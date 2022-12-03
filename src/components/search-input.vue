<template>
  <div class="search-input">
    <input
      type="search"
      :ref="s => { $search = s as HTMLInputElement; }"
      :aria-label="ariaLabel ?? 'Search'"
      :title="props.tooltip"
      :placeholder="props.placeholder"
      v-model="modelValue"
      @keydown.esc.prevent.stop="clear"
    />
    <button
      v-if="modelValue !== ''"
      class="clear"
      aria-label="Clear Search"
      title="Clear search"
      @click.prevent.stop="clear"
    />
  </div>
</template>

<script lang="ts">
import {computed, onMounted, ref} from "vue";
</script>

<script setup lang="ts">
const props = defineProps<{
  tooltip?: string;
  placeholder?: string;
  ariaLabel?: string;

  modelValue: string;
  focusOnMount?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
}>();

const modelValue = computed({
  get(): string {
    return props.modelValue;
  },
  set(v: string) {
    emit("update:modelValue", v);
  },
});

const $search = ref(undefined! as HTMLInputElement);

if (props.focusOnMount) onMounted(() => $search.value.focus());

function clear() {
  emit("update:modelValue", "");
}
</script>
