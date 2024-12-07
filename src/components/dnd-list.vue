<template>
  <ul
    :data-dnd-orientation="props.orientation"
    v-droppable="{
      orientation: () => props.orientation,
      accepts: parentAccepts,
      drop: parentDrop,
    }"
  >
    <li
      v-for="(item, index) of modelValue"
      :class="itemClass ? itemClass(item, index) : undefined"
      :key="itemKey(item)"
      v-draggable="{
        start: data => itemDragStart(data, item, index),
        end: itemDragEnd,
      }"
      v-droppable="{
        orientation: () => props.orientation,
        accepts: data => itemAccepts(data, item, index),
        drop: ev => itemDrop(ev, index),
      }"
    >
      <slot name="item" :item="item" />
    </li>
  </ul>
</template>

<script lang="ts">
import {type DragAction, type DropAction} from "./dnd.js";
</script>

<script setup lang="ts" generic="I">
import {ref} from "vue";
import {logErrorsFrom} from "../util/oops.js";

import {type DNDAcceptedDropPositions, type DropEvent} from "./dnd.js";
import {vDraggable, vDroppable} from "./dnd-directives.js";

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

function parentAccepts(data: DataTransfer): DNDAcceptedDropPositions {
  if (props.accepts instanceof Array) {
    if (!data.types.find(t => props.accepts!.includes(t))) return null;
  } else if (props.accepts) {
    if (!data.types.includes(props.accepts)) return null;
  } else {
    return null;
  }
  return props.parentAcceptsDrop ? "inside" : null;
}

function itemAccepts(
  data: DataTransfer,
  item: I,
  index: number,
): DNDAcceptedDropPositions {
  if (props.accepts instanceof Array) {
    if (!data.types.find(t => props.accepts!.includes(t))) return null;
  } else if (props.accepts) {
    if (!data.types.includes(props.accepts)) return null;
  } else {
    return null;
  }

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

function itemDragStart(ev: DataTransfer, item: I, index: number) {
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
