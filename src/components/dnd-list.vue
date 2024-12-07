<template>
  <dnd-item
    is="ul"
    :orientation="props.orientation"
    :accept-positions="parentAcceptsDrop ? 'inside' : undefined"
    :accept-types="props.accepts"
    @drop="parentDrop"
  >
    <dnd-item
      v-for="(item, index) of modelValue"
      :class="itemClass ? itemClass(item, index) : undefined"
      :key="itemKey(item)"
      is="li"
      draggable
      :orientation="props.orientation"
      :accept-positions="acceptPos(item, index)"
      :accept-types="props.accepts"
      @drag="itemDrag($event, item, index)"
      @dragend="itemDragEnd"
      @drop="itemDrop($event, index)"
    >
      <slot name="item" :item="item" />
    </dnd-item>
  </dnd-item>
</template>

<script lang="ts">
import {type DragAction, type DropAction} from "./dnd.js";
</script>

<script setup lang="ts" generic="I">
import {ref} from "vue";
import {logErrorsFrom} from "../util/oops.js";

import {type DNDAllowedDropPositions, type DropEvent} from "./dnd.js";
import dndItem from "./dnd-item.vue";

const props = defineProps<{
  itemKey: (item: I) => string | number;
  itemClass?: (item: I, index: number) => Record<string, boolean>;
  itemAcceptsDropInside?: (item: I, index: number) => boolean;
  parentAcceptsDrop?: "beginning" | "end";
  accepts: string | readonly string[];
  modelValue: I[];

  drag: (drag: DragAction<I>) => void;
  drop: (drop: DropAction) => Promise<void>;

  /** What is the visual orientation of the list? */
  orientation: "horizontal" | "vertical" | "grid";
}>();

const draggingIndex = ref(-1);

function acceptPos(item: I, index: number): DNDAllowedDropPositions {
  if (props.itemAcceptsDropInside && props.itemAcceptsDropInside(item, index)) {
    if (props.orientation === "grid") {
      return draggingIndex.value < index ? "inside-after" : "before-inside";
    }
    return "before-inside-after";
  } else {
    if (props.orientation === "grid") {
      return draggingIndex.value < index ? "after" : "before";
    }
    return "before-after";
  }
}

function itemDrag(ev: DataTransfer, item: I, index: number) {
  props.drag({
    dataTransfer: ev,
    fromIndex: index,
    value: item,
  });
  draggingIndex.value = index;
}

function itemDragEnd() {
  draggingIndex.value = -1;
}

function itemDrop(ev: DropEvent, index: number) {
  const drop_ev: DropAction = {
    dataTransfer: ev.data,
    toIndex: index + (ev.position === "after" ? 1 : 0),
    dropInside: ev.position === "inside",
  };

  logErrorsFrom(() => props.drop(drop_ev));
}

function parentDrop(ev: DropEvent) {
  let drop_ev: DropAction;
  switch (props.parentAcceptsDrop) {
    case undefined:
      return;
    case "beginning":
      drop_ev = {
        dataTransfer: ev.data,
        toIndex: 0,
      };
    case "end":
      drop_ev = {
        dataTransfer: ev.data,
        toIndex: props.modelValue.length,
      };
  }
  logErrorsFrom(() => props.drop(drop_ev));
}
</script>
