<template>
  <component
    :is="props.is || 'div'"
    ref="$el"
    :data-dnd-orientation="orientation"
  >
    <slot />
  </component>
</template>

<script lang="ts">
import {useTemplateRef} from "vue";

import {
  makeDraggable,
  makeDroppable,
  type DropEvent,
  type DNDAllowedDropPositions,
} from "./dnd.js";
</script>

<script setup lang="ts">
const props = defineProps<{
  /** The DOM element name to use (e.g. `li` if this is a list item) */
  is?: string;

  /** For deciding whether a drop is 'before', 'after', or 'inside' this
   * element, we need to know where, spatially, that is. */
  orientation: "vertical" | "horizontal" | "grid";

  /** Is this item itself draggable? */
  draggable?: boolean;

  /** The allowable positions for items dropped on or adjacent to us. */
  acceptPositions?: DNDAllowedDropPositions;

  /** Dropped data types we accept. (Typically a MIME type.) */
  acceptTypes?: string | readonly string[];
}>();

const emit = defineEmits<{
  /** Emitted when a drag is started. Callee is responsible for populating the
   * data-transfer object with relevant types and allowed drop effects. */
  (e: "drag", ev: DataTransfer): void;

  /** Emitted on a dragged item when a drag ends, either because of success or
   * cancellation/failure. */
  (e: "dragend"): void;

  /** Emitted when a drop is completed. */
  (e: "drop", ev: DropEvent): void;
}>();

const $el = useTemplateRef<HTMLElement>("$el");

if (props.draggable) {
  makeDraggable($el, {
    onDragStart(data: DataTransfer): void {
      emit("drag", data);
    },
    onDragEnd() {
      emit("dragend");
    },
  });
}

makeDroppable($el, {
  orientation: () => props.orientation,
  allowsDrop(data: DataTransfer): DNDAllowedDropPositions {
    if (!props.acceptPositions) return null;

    if (props.acceptTypes instanceof Array) {
      if (!data.types.find(t => props.acceptTypes!.includes(t))) return null;
    } else if (props.acceptTypes) {
      if (!data.types.includes(props.acceptTypes)) return null;
    } else {
      return null;
    }

    return props.acceptPositions;
  },
  onDrop(event: DropEvent): void {
    emit("drop", event);
  },
});
</script>
