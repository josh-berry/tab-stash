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
      :key="itemKey(item, index)"
      :class="itemClass ? itemClass(item, index) : undefined"
      v-draggable="{
        start: data => itemDragStart(data, item, index),
        end: itemDragEnd,
      }"
      v-droppable="{
        orientation: () => props.orientation,
        accepts: data => itemAccepts(data, item, index),
        drop: ev => itemDrop(ev, item, index),
      }"
    >
      <slot name="item" :item="item" />
    </li>
  </ul>
</template>

<script lang="ts">
/** Fired when the user begins dragging an item in the list. */
export interface ListDragEvent<I> {
  /** The item being dragged. */
  item: I;

  /** The index of the item being dragged. */
  fromIndex: number;

  /** The DataTransfer should be populated with information describing `item`,
   * such that `item` can be moved or copied when dropped at its destination
   * (which may be in a different app entirely). */
  data: DataTransfer;
}

/** Fired when the user drops item(s) with the intention of inserting them into
 * the list at the specified position. */
export interface ListDropEvent {
  /** The DataTransfer object that describes the dropped item(s). */
  data: DataTransfer;

  /** The position in the list at which to insert the dropped item(s).  The
   * item(s) should be inserted in the list such that they precede the item
   * _currently_ at index `insertBeforeIndex`. Or, if `insertBeforeIndex ==
   * list.length`, the item(s) should be inserted at the end of the list. */
  insertBeforeIndex: number;
}

/** Fired when the user drops item(s) with the intention of inserting them
 * inside the specified item in the list (e.g. as children). */
export interface ListDropInsideEvent<I> {
  /** The DataTransfer object that describes the dropped item(s). */
  data: DataTransfer;

  /** The parent item into which the dropped item(s) should be inserted.  It is
   * up to the callee where in the child they should be placed (typically they
   * would be placed at the end). */
  insertInParent: I;
}
</script>

<script setup lang="ts" generic="I">
import {ref} from "vue";

import {
  type DNDAcceptedDropPositions,
  type DNDOrientation,
  type DropEvent,
} from "./dnd.js";
import {vDraggable, vDroppable} from "./dnd-directives.js";

const props = defineProps<{
  /** What is the visual orientation of the list?  During a drag operation, this
   * is used in conjunction with the position of the mouse cursor to decide
   * whether the user intends to drop before, inside, or after the item they're
   * hovering over. */
  orientation: DNDOrientation;

  /** The items in the list. */
  modelValue: I[];

  /** Returns a unique key for each item. This is the same as Vue's special
   * `key` attribute inside `v-for`. */
  itemKey: (item: I, index: number) => string | number;

  /** Returns a set of CSS classes to apply to the specified item. */
  itemClass?: (item: I, index: number) => Record<string, boolean>;

  /** Checks whether the dragged data in `data` can be dropped within or
   * adjacent to the specified item/index. */
  itemAccepts: (
    data: DataTransfer,
    item: I,
    index: number,
  ) => DNDAcceptedDropPositions;

  /** If the list is empty, checks whether the dragged data in `data` can be
   * dropped in the list as its only item. */
  listAccepts: (data: DataTransfer) => boolean;
}>();

const emit = defineEmits<{
  /** Fired when the user starts to drag an item in the list.  The callee must
   * fill in the `data` field of the ListDragEvent with information on the item
   * being dragged. */
  (e: "drag", event: ListDragEvent<I>): void;

  /** Fired when the user drops an item into this list, adjacent to another
   * item.  The dropped item is guaranteed to have been previously-validated by
   * the `itemAccepts()` function. The callee should insert the dropped item
   * into the list such that its index is `toIndex`. */
  (e: "drop", event: ListDropEvent): void;

  /** Fired when the user drops an item inside a particular item in this list.
   * The dropped item should be inserted in an appropriate position as a child
   * of the item it was dropped on. */
  (e: "dropInside", event: ListDropInsideEvent<I>): void;
}>();

const draggingIndex = ref(-1);

function itemDragStart(data: DataTransfer, item: I, fromIndex: number) {
  emit("drag", {data, item, fromIndex});
  draggingIndex.value = fromIndex;
}

function itemDragEnd() {
  draggingIndex.value = -1;
}

function itemDrop(ev: DropEvent, item: I, index: number) {
  if (ev.position === "inside") {
    emit("dropInside", {data: ev.data, insertInParent: item});
  } else {
    emit("drop", {
      data: ev.data,
      insertBeforeIndex: index + (ev.position === "after" ? 1 : 0),
    });
  }
}

function parentAccepts(data: DataTransfer): DNDAcceptedDropPositions {
  if (props.listAccepts(data)) return "inside";
  return null;
}

function parentDrop(ev: DropEvent) {
  emit("drop", {data: ev.data, insertBeforeIndex: props.modelValue.length});
}
</script>
