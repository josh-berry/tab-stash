<template>
  <component
    :is="props.is || 'div'"
    ref="$el"
    :data-dnd-orientation="orientation"
    :data-dnd-dragging="isDragging"
    :data-dnd-dropping="dropPosition"
    :draggable="props.draggable && dragEnabled"
    @mousedown="mouseDown"
    @mouseup="mouseUp"
    @dragstart="dragStart"
    @dragend="dragEnd"
    @dragenter="dragEnter"
    @dragover="dragOver"
    @dragleave="dragLeave"
    @drop="drop"
  >
    <slot />
  </component>
</template>

<script lang="ts">
import {ref} from "vue";
import {trace_fn} from "../util/debug.js";

export type DNDDropPosition = "before" | "inside" | "after";

export type DNDAllowedDropPositions =
  | DNDDropPosition
  | "before-after"
  | "before-inside"
  | "inside-after"
  | "before-inside-after";

export type DropEvent = {
  dom: DragEvent;
  position: DNDDropPosition;
};

const trace = trace_fn("dnd-item");

// This is an ugly bit of global state to allow different <dnd-item>s to
// coordinate with each other about drag-and-drop events. Firefox sometimes
// just... doesn't fire dragleave events for some reason, so there's no reliable
// way to know when a dragged item is no longer in its drop target. Sigh.
let clearDragStateHook = () => {};
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

const $el = ref<Element>(undefined!);

// Whether to set `draggable="true"` on the DOM element. We only do this when we
// actually want to start dragging.  This allows for our children to intercept
// mousedown events to prevent dragging, so that such children can be interacted
// with or dragged themselves.
const dragEnabled = ref(false);

const isDragging = ref(false);
const dropPosition = ref(undefined as DNDDropPosition | undefined);

//
// EVENTS ON THE DRAGGED ITEM
//

function mouseDown(ev: MouseEvent) {
  if (!props.draggable) return;
  dragEnabled.value = true;
  ev.stopPropagation();
}

function mouseUp(ev: MouseEvent) {
  if (!props.draggable) return;
  dragEnabled.value = false;
  ev.stopPropagation();
}

/** Fired when the user actually starts dragging this item. */
function dragStart(ev: DragEvent) {
  trace("dragStart", ev);
  if (!props.draggable) {
    dragEnabled.value = false;
    return;
  }

  ev.stopPropagation();

  // As explained above.
  dragEnabled.value = false;
  isDragging.value = true;
  dropPosition.value = undefined;

  emit("drag", ev.dataTransfer!);
}

/** Fired on the source item when the drag is finished, regardless of whether it
 * succeeded, failed, or was cancelled. */
function dragEnd(ev: DragEvent) {
  trace("dragEnd", ev);
  dragEnabled.value = false;
  isDragging.value = false;
  dropPosition.value = undefined;
  clearDragState();
  emit("dragend");
}

//
// EVENTS ON THE DROP TARGET
//

/** Fired when a drag enters this item. Checks if we're a valid drop target,
 * calculates the drop position, and updates the event accordingly. */
function dragEnter(ev: DragEvent) {
  trace("dragEnter", ev);
  if (!allowDropHere(ev)) return;
  ev.stopPropagation();

  resetDragState();
  dropPosition.value = dropPos(ev);
}

/** Fired periodically while the user is dragging inside this item. Checks if
 * we're a valid drop target, and updates the drop position accordingly. */
function dragOver(ev: DragEvent) {
  trace("dragOver", ev);
  if (!allowDropHere(ev)) return;
  ev.stopPropagation();

  resetDragState();
  dropPosition.value = dropPos(ev);
}

/** Fired when a drag leaves this item. Always fires even if a drop is canceled,
 * so we can clear any state involved in the DnD operation. */
function dragLeave(ev: DragEvent) {
  trace("dragLeave", ev);
  if (!allowDropHere(ev)) return;
  ev.stopPropagation();

  dropPosition.value = undefined;
}

/** Fired when the user drops an item over us. */
function drop(ev: DragEvent) {
  trace("drop", ev);
  if (!allowDropHere(ev)) return;
  ev.stopPropagation();

  dropPosition.value = dropPos(ev);
  trace("drop position", dropPosition.value);

  emit("drop", {dom: ev, position: dropPosition.value});
  clearDragState();
}

//
// HELPER FUNCTIONS
//

/** Registers a hook for other <dnd-item> components to be able to call us back
 * when our drag state should be cleared (e.g. because the drop target has
 * changed, but we never got a notification from Firefox).
 *
 * Only one <dnd-item> can be a drop target at a time, so this always clears the
 * drag state of the prior <dnd-item> before registering our hook. */
function resetDragState() {
  clearDragStateHook();
  clearDragStateHook = () => {
    dropPosition.value = undefined;
  };
}

/** Clears any drag state that's still present on any <dnd-item>. */
function clearDragState() {
  clearDragStateHook();
  clearDragStateHook = () => {};
}

/** Rejects the potential drop operation if this isn't a suitable location for
 * the drag that's in progress. */
function allowDropHere(ev: DragEvent): boolean {
  if (!ev.dataTransfer) return false;
  const types = ev.dataTransfer.types;

  if (!props.acceptPositions) return false;

  if (props.acceptTypes instanceof Array) {
    if (!types.find(t => props.acceptTypes!.includes(t))) return false;
  } else if (props.acceptTypes) {
    if (!types.includes(props.acceptTypes)) return false;
  } else {
    return false;
  }

  ev.preventDefault();
  return true;
}

const POSITIONS: DNDDropPosition[] = ["before", "inside", "after"];

/** Compute the desired drop position based on the mouse cursor's position
 * inside the element, and the set of allowed drop positions. */
function dropPos(ev: DragEvent): DNDDropPosition {
  if (!props.acceptPositions) throw new Error("No positions accepted");
  return dropPosImpls[props.orientation][props.acceptPositions](ev);
}

const dropPosImpls = {
  vertical: {
    before: (_: DragEvent) => "before" as DNDDropPosition,
    inside: (_: DragEvent) => "inside" as DNDDropPosition,
    after: (_: DragEvent) => "after" as DNDDropPosition,
    "before-after"(ev: DragEvent): DNDDropPosition {
      const elSize = $el.value.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientY - elSize.y)) / elSize.height);
      return POSITIONS[slice * 2];
    },
    "before-inside"(ev: DragEvent): DNDDropPosition {
      const elSize = $el.value.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientY - elSize.y)) / elSize.height);
      return POSITIONS[slice];
    },
    "inside-after"(ev: DragEvent): DNDDropPosition {
      const elSize = $el.value.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientY - elSize.y)) / elSize.height);
      return POSITIONS[slice + 1];
    },
    "before-inside-after"(ev: DragEvent): DNDDropPosition {
      const elSize = $el.value.getBoundingClientRect();
      const slice = Math.floor((3 * (ev.clientY - elSize.y)) / elSize.height);
      return POSITIONS[slice];
    },
  },
  horizontal: {
    before: (_: DragEvent) => "before" as DNDDropPosition,
    inside: (_: DragEvent) => "inside" as DNDDropPosition,
    after: (_: DragEvent) => "after" as DNDDropPosition,
    "before-after"(ev: DragEvent): DNDDropPosition {
      const elSize = $el.value.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientX - elSize.x)) / elSize.width);
      return POSITIONS[slice * 2];
    },
    "before-inside"(ev: DragEvent): DNDDropPosition {
      const elSize = $el.value.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientX - elSize.x)) / elSize.width);
      return POSITIONS[slice];
    },
    "inside-after"(ev: DragEvent): DNDDropPosition {
      const elSize = $el.value.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientX - elSize.x)) / elSize.width);
      return POSITIONS[slice + 1];
    },
    "before-inside-after"(ev: DragEvent): DNDDropPosition {
      const elSize = $el.value.getBoundingClientRect();
      const slice = Math.floor((3 * (ev.clientX - elSize.x)) / elSize.width);
      return POSITIONS[slice];
    },
  },
  grid: {
    before: (_: DragEvent) => "before" as DNDDropPosition,
    inside: (_: DragEvent) => "inside" as DNDDropPosition,
    after: (_: DragEvent) => "after" as DNDDropPosition,
    "before-after"(ev: DragEvent): DNDDropPosition {
      const elSize = $el.value.getBoundingClientRect();
      return isAboveDiagonal(ev, elSize) ? "before" : "after";
    },
    "before-inside"(ev: DragEvent): DNDDropPosition {
      if (isInCenter(ev)) return "inside";
      return "before";
    },
    "inside-after"(ev: DragEvent): DNDDropPosition {
      if (isInCenter(ev)) return "inside";
      return "after";
    },
    "before-inside-after"(ev: DragEvent): DNDDropPosition {
      if (isInCenter(ev)) return "inside";
      const elSize = $el.value.getBoundingClientRect();
      return isAboveDiagonal(ev, elSize) ? "before" : "after";
    },
  },
};

/** Is the mouse cursor in the center of the item? */
function isInCenter(ev: DragEvent): boolean {
  const elSize = $el.value.getBoundingClientRect();
  const x = Math.floor((3 * (ev.clientX - elSize.x)) / elSize.width);
  const y = Math.floor((3 * (ev.clientY - elSize.y)) / elSize.height);
  return x === 1 && y === 1;
}

/** Is the mouse cursor below the diagonal "before/after" split in this item? */
function isAboveDiagonal(ev: DragEvent, elSize: DOMRect): boolean {
  const slope = elSize.height / elSize.width;
  return !(
    ev.clientY - elSize.y >=
    -slope * (ev.clientX - elSize.x) + elSize.height
  );
}
</script>
