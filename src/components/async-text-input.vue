<template>
  <input
    ref="$input"
    type="text"
    v-model="state.dirtyValue"
    :placeholder="defaultValue"
    :disabled="!!state.saving"
    @mousedown.stop=""
    @mouseup.stop=""
    @click.stop=""
    @auxclick.stop=""
    @keydown.stop=""
    @keyup.stop=""
    @keypress.stop=""
    @blur="commit"
    @keyup.enter.prevent.stop="commit"
    @keyup.esc.prevent.stop="cancel"
  />
</template>

<script setup lang="ts">
import {onMounted, ref, shallowReactive} from "vue";

const props = defineProps<{
  /** Async function which is called when it's time to save the edited value.
   * Edits are blocked until the returned promise resolves or rejects.
   *
   * If the promise resolves, the edit is assumed to have been saved
   * successfully and a `save` event is emitted.  If the promise rejects, we
   * assume something has failed and we roll back to editing state, keeping
   * the unsaved/dirty value.  No events are emitted in this case, since it's
   * assumed the user will cancel or retry. */
  save: (newValue: string) => Promise<void>;

  /** The value as it's currently stored. */
  value: string;

  /** The default value to show if the value is the empty string. */
  defaultValue: string;
}>();

const emit = defineEmits<{
  /** Emitted once the value has been successfully saved. */
  (e: "save", value: string): void;

  /** Emitted when editing is cancelled by the user. */
  (e: "cancel"): void;

  /** Emitted on either `cancel` or `save`.  If the value provided is
   * `undefined`, the edit was cancelled. */
  (e: "done", value?: string): void;
}>();

const state = shallowReactive({
  dirtyValue: props.value,
  saving: undefined as Promise<void> | undefined,
});

const $input = ref<HTMLInputElement>();

onMounted(() => {
  if ($input.value) {
    $input.value.focus();
    $input.value.select();
  }
});

function commit() {
  // If we're already saving, we can't start another save operation
  if (state.saving) return;

  if (state.dirtyValue === props.value) {
    // Nothing to save; the value is already correct
    cancel();
    return;
  }

  state.saving = props.save(state.dirtyValue).then(
    () => {
      const v = state.dirtyValue;
      state.dirtyValue = props.value;
      state.saving = undefined;
      emit("save", v);
      emit("done", v);
    },
    () => {
      // Rejected; save our dirty state and let the user retry.
      state.saving = undefined;
    },
  );
}

function cancel() {
  // Once we're mid-save, we can't cancel
  if (state.saving) return;

  state.dirtyValue = props.value;
  emit("cancel");
  emit("done");
}
</script>
