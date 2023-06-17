<template>
  <teleport to="body">
    <Dialog @close="answer(false)">
      <section>
        <slot />
      </section>

      <section>
        <label
          for="ask_next_time"
          title="If you change your mind, you can turn this confirmation on again in the options."
        >
          <input type="checkbox" id="ask_next_time" v-model="confirmNextTime" />
          Ask me again next time
        </label>
      </section>

      <template #buttons>
        <button
          :class="{'confirm-dialog-default': !props.confirmByDefault}"
          :ref="b => { $cancel = b as HTMLButtonElement; }"
          @click="answer(false)"
        >
          {{ props.cancel }}
        </button>

        <button
          :class="{'confirm-dialog-default': props.confirmByDefault}"
          :ref="b => { $confirm = b as HTMLButtonElement; }"
          @click="answer(true)"
        >
          {{ props.confirm }}
        </button>
      </template>
    </Dialog>
  </teleport>
</template>

<script lang="ts">
import {onMounted, ref} from "vue";

import Dialog from "./dialog.vue";

// Users typically don't expect that toggling the "Confirm next time" option
// will take effect if they cancel the whole dialog.  Thus we only report
// confirmNextTime if the user actually confirmed.  (And at runtime, just to be
// safe, we always report confirmNextTime === true if confirmed === false.)
export type ConfirmEvent = {confirmed: true; confirmNextTime: boolean};
export type CancelEvent = {confirmed: false; confirmNextTime: true};
export type ConfirmDialogEvent = ConfirmEvent | CancelEvent;
</script>

<script setup lang="ts">
const props = defineProps<{
  confirm: string;
  cancel: string;
  confirmByDefault?: boolean;
}>();

const emit = defineEmits<{
  (e: "confirm", event: ConfirmEvent): void;
  (e: "cancel", event: CancelEvent): void;
  (e: "answer", event: ConfirmDialogEvent): void;
}>();

const confirmNextTime = ref(true);

const $confirm = ref(undefined! as HTMLButtonElement);
const $cancel = ref(undefined! as HTMLButtonElement);

onMounted(() => {
  if (props.confirmByDefault) {
    $confirm.value.focus();
  } else {
    $cancel.value.focus();
  }
});

function answer(confirmed: boolean) {
  if (confirmed) {
    emit("answer", {confirmed: true, confirmNextTime: confirmNextTime.value});
    emit("confirm", {confirmed: true, confirmNextTime: confirmNextTime.value});
  } else {
    // If the user cancelled, we always confirmNextTime to avoid confusion.
    emit("answer", {confirmed: false, confirmNextTime: true});
    emit("cancel", {confirmed: false, confirmNextTime: true});
  }
}
</script>
