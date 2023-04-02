<template>
  <div class="search-input">
    <input
      type="search"
      :ref="s => { $search = s as HTMLInputElement; }"
      :aria-label="ariaLabel ?? 'Search'"
      :title="props.tooltip"
      :placeholder="props.placeholder"
      v-model="modelValue"
      @keydown.esc.prevent="clear"
    />
    <button
      v-if="modelValue !== ''"
      class="clear"
      aria-label="Clear Search"
      title="Clear search"
      tabindex="-1"
      @click.prevent.stop="clear"
    />
  </div>
</template>

<script lang="ts">
import {computed, ref} from "vue";
</script>

<script setup lang="ts">
const props = defineProps<{
  tooltip?: string;
  placeholder?: string;
  ariaLabel?: string;

  modelValue: string;
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

defineExpose({
  focus() {
    $search.value.focus();
  },
});

function clear(ev: KeyboardEvent | MouseEvent) {
  if (modelValue.value !== "") {
    // We consume the "clear" event only if we want to clear the search box,
    // because if the search box is present in a dialog/menu/etc., hitting "Esc"
    // twice will both clear the search AND close the parent modal.
    ev.stopPropagation();
    emit("update:modelValue", "");
  }
}
</script>
