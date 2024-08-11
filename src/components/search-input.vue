<template>
  <div class="search-input">
    <input
      type="search"
      :ref="
        s => {
          $search = s as HTMLInputElement;
        }
      "
      :aria-label="ariaLabel ?? 'Search'"
      :title="props.tooltip"
      :placeholder="props.placeholder"
      v-model="searchContent"
      @keydown.esc.prevent="clear"
      @keydown.enter.prevent="updateModelValue"
    />
    <button
      v-if="searchContent !== ''"
      class="clear"
      aria-label="Clear Search"
      title="Clear search"
      tabindex="-1"
      @click.prevent.stop="clear"
    />
  </div>
</template>

<script lang="ts">
import {ref, watch, watchEffect, type WatchStopHandle} from "vue";
</script>

<script setup lang="ts">
const props = defineProps<{
  tooltip?: string;
  placeholder?: string;
  ariaLabel?: string;

  modelValue: string;

  debounceMs?: number;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
}>();

// searchContent tracks what's actually in the text box at any given moment.  We
// watch searchContent and emit modelValue updates so that we can debounce
// updates--this way, component users can do more expensive things (like
// re-searching) in their modelValue event handlers without it impacting
// performance as much.
const searchContent = ref("");
let debounceTimeout: number | undefined = undefined;
watch(searchContent, () => {
  // If debounce is disabled or we're clearing the search field, emit the update
  // immediately. We never want to debounce on clear, because it usually means
  // the user is done searching.
  if (!props.debounceMs || searchContent.value === "") {
    emit("update:modelValue", searchContent.value);
    return;
  }

  if (debounceTimeout !== undefined) clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(updateModelValue, props.debounceMs);
});

const $search = ref(undefined! as HTMLInputElement);

defineExpose({
  focus() {
    // The watchEffect() is needed to avoid a race between the parent component
    // being mounted and asking us to focus ourselves, and the actual mounting
    // of this component.
    let cancel: WatchStopHandle | undefined = undefined;
    cancel = watchEffect(() => {
      if ($search.value) {
        $search.value.focus();
        setTimeout(() => cancel!());
      }
    });
  },
});

function clear(ev: KeyboardEvent | MouseEvent) {
  if (searchContent.value !== "") {
    // We consume the "clear" event only if we want to clear the search box,
    // because if the search box is present in a dialog/menu/etc., hitting "Esc"
    // twice will both clear the search AND close the parent modal.
    ev.stopPropagation();
    searchContent.value = "";
  }
}

/** Trigger a model update immediately. */
function updateModelValue() {
  if (debounceTimeout !== undefined) {
    clearTimeout(debounceTimeout);
    debounceTimeout = undefined;
    emit("update:modelValue", searchContent.value);
  }
}
</script>
