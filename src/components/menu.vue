<template>
  <details
    class="menu"
    ref="$details"
    :open="isOpen"
    :class="{
      above: vertical === 'above',
      below: vertical === 'below',
      left: horizontal === 'left',
      right: horizontal === 'right',
    }"
    @toggle="onToggle"
    @focusout="onFocusOut"
  >
    <summary ref="$summary" :class="summaryClass" tabindex="0">
      <slot name="summary">{{ name }}</slot>
    </summary>

    <div
      v-if="isOpen"
      :style="bounds"
      :class="{
        'menu-modal': true,
        [$style.modal]: true,
        [modalClass ?? '']: true,
        above: vertical === 'above',
        below: vertical === 'below',
        left: horizontal === 'left',
        right: horizontal === 'right',
      }"
      tabindex="-1"
      @keydown.esc.prevent.stop="close"
      @click.prevent.stop="close"
    >
      <nav
        ref="$menu"
        :class="{menu: true, [$style.menu]: true}"
        tabIndex="0"
        @click.stop="close"
      >
        <slot></slot>
      </nav>
    </div>
  </details>
</template>

<script lang="ts">
import {computed, nextTick, ref} from "vue";

import {onceRefHasValue} from "../util/index.js";
import {trace_fn} from "../util/debug.js";

const trace = trace_fn("menus");
</script>

<script setup lang="ts">
const props = defineProps<{
  name?: string;
  summaryClass?: string;
  modalClass?: string;
  hPosition?: "left" | "right";
  vPosition?: "above" | "below";
}>();

const emit = defineEmits<{
  (e: "open"): void;
  (e: "close"): void;
}>();

defineExpose({open, close});

const viewport = ref<DOMRect>();
const origin = ref<DOMRect>();
const vertical = ref<"above" | "below">();
const horizontal = ref<"left" | "right">();
const isOpen = ref(false);

const $details = ref<HTMLDetailsElement>();
const $summary = ref<HTMLElement>();
const $menu = ref<HTMLElement>();

const vertical_bound = computed(() => {
  if (vertical.value === "below") {
    return `padding-top: ${origin.value?.bottom || 0}px;`;
  } else {
    return `padding-bottom: ${viewport.value!.height - origin.value!.top}px;`;
  }
});

const horizontal_bound = computed(() => {
  if (horizontal.value === "left") {
    return `padding-left: ${origin.value?.left}px;`;
  } else {
    return `padding-right: ${viewport.value!.width - origin.value!.right}px;`;
  }
});

const bounds = computed(
  () => `${horizontal_bound.value} ${vertical_bound.value}`,
);

function open() {
  trace("open");

  isOpen.value = true;

  viewport.value = document.body.getBoundingClientRect();
  const pos = $summary.value!.getBoundingClientRect();
  const focus = {
    x: viewport.value!.width / 2,
    y: (2 * viewport.value!.height) / 3,
  };

  origin.value = pos;
  vertical.value =
    props.vPosition ?? (pos.bottom < focus.y ? "below" : "above");
  horizontal.value =
    props.hPosition ?? (pos.right < focus.x ? "left" : "right");

  onceRefHasValue($menu, m => {
    // Make sure the focus is within the menu so we can detect when
    // focus leaves the menu, and close it automatically.
    m.focus();
    emit("open");
  });
}

function close() {
  trace("close");

  // Move the focus out of the menu before we try to close it,
  // otherwise Firefox gets confused about where the focus is and will
  // forget to turn off :focus-within attributes on some parent
  // elements... (this seems to be a Firefox bug)
  if ($details.value) $details.value.focus();

  isOpen.value = false;
  nextTick(() => {
    vertical.value = undefined;
    horizontal.value = undefined;
    emit("close");
    if ($summary.value) $summary.value.blur();
  });
}

function onToggle() {
  trace("toggle");
  if ($details.value!.open) {
    open();
  } else {
    close();
  }
}

function onFocusOut() {
  if ((<any>globalThis).menu_close_on_blur === false) return;
  if (!$menu.value) return;
  if ($menu.value!.closest("details.menu:focus-within") !== $details.value!) {
    trace("lost focus");
    close();
  }
}
</script>

<style module>
.modal {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 100;

  box-sizing: border-box;
  cursor: default;
  overflow: hidden;

  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}

.modal:global(.above) {
  align-items: end;
}
.modal:global(.below) {
  align-items: start;
}
.modal:global(.left) {
  justify-items: start;
}
.modal:global(.right) {
  justify-items: end;
}

.menu {
  box-sizing: border-box;
  max-width: 100%;
  max-height: 100%;
}
</style>
