<template>
  <ul>
    <dnd-item
      v-for="(item, index) of modelValue"
      :class="itemClass ? itemClass(item, index) : undefined"
      :key="itemKey(item)"
      is="li"
      draggable
      :orientation="props.orientation"
      :accept-positions="
        itemIsContainer && itemIsContainer(item, index)
          ? 'before-inside-after'
          : 'before-after'
      "
      :accept-types="props.accepts"
      @drag="itemDrag($event, item, index)"
      @drop="itemDrop($event, index)"
    >
      <slot name="item" :item="item" />
    </dnd-item>
  </ul>
</template>

<script lang="ts">
import {type DragAction, type DropAction} from "./dnd-list.js";
</script>

<script setup lang="ts" generic="I">
import {logErrorsFrom} from "../util/oops.js";
import dndItem, {type DropEvent} from "./dnd-item.vue";

const props = defineProps<{
  itemKey: (item: I) => string | number;
  itemClass?: (item: I, index: number) => Record<string, boolean>;
  itemIsContainer?: (item: I, index: number) => boolean;
  accepts: string | readonly string[];
  modelValue: I[];

  drag: (drag: DragAction<I>) => void;
  drop: (drop: DropAction) => Promise<void>;

  /** What is the visual orientation of the list? */
  orientation: "horizontal" | "vertical" | "grid";
}>();

function itemDrag(ev: DataTransfer, item: I, index: number) {
  props.drag({
    dataTransfer: ev,
    fromIndex: index,
    value: item,
  });
}

function itemDrop(ev: DropEvent, index: number) {
  const drop_ev: DropAction = {
    dataTransfer: ev.dom.dataTransfer!,
    toIndex: index + (ev.position === "after" ? 1 : 0),
    dropInside: ev.position === "inside",
  };

  logErrorsFrom(() => props.drop(drop_ev));
}
</script>
