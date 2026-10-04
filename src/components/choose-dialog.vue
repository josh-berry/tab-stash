<template>
  <Dialog @close="cancel">
    <section>
      <slot />
    </section>

    <template #buttons>
      <button
        v-for="(choice, index) of props.choices"
        :class="{'choose-dialog-default': index === props.defaultIndex}"
        :ref="
          b => {
            if (index === props.defaultIndex) $default = b as HTMLButtonElement;
          }
        "
        @click="choose(choice)"
      >
        {{ choice.text }}
      </button>
    </template>
  </Dialog>
</template>

<script lang="ts">
import {onMounted, onUpdated, ref} from "vue";

import Dialog from "./dialog.vue";

export type ChooseEvent<A> = {choice: A};
export type CancelEvent = {};

export type Choice<A> = {
  text: string;
  choice: A;
};
</script>

<script setup lang="ts" generic="A">
const props = defineProps<{
  choices: Choice<A>[];
  defaultIndex: number;
}>();

const emit = defineEmits<{
  (e: "choose", ev: ChooseEvent<A>): void;
  (e: "cancel", ev: CancelEvent): void;
  (e: "answer", ev: ChooseEvent<A> | CancelEvent): void;
}>();

const $default = ref(undefined as HTMLButtonElement | undefined);

onMounted(() => {
  if ($default.value) $default.value.focus();
});

onUpdated(() => {
  if ($default.value) $default.value.focus();
});

function choose(choice: Choice<A>) {
  emit("choose", {choice: choice.choice});
  emit("answer", {choice: choice.choice});
}

function cancel() {
  emit("cancel", {});
  emit("answer", {});
}
</script>
