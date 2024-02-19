<template>
  <component
    :is="is || 'ul'"
    class="dnd-list"
    ref="$top"
    @dragenter="parentDragEnter"
    @dragleave="parentDragExit"
    @dragexit="parentDragExit"
    @dragover="itemDragOver"
    @drop="doDrop"
  >
    <template v-for="(item, index) of displayItems" :key="itemKey(item)">
      <component
        v-if="index === state.droppingToIndex"
        :is="itemIs || 'li'"
        :style="ghostStyle"
        class="dnd-list-ghost dropping-here"
        :data-key="itemKey(item)"
        @dragenter="ghostDragEnter($event, index)"
        @dragover="ghostDragOver($event)"
        @drop="doDrop"
      >
        <slot name="ghost" />
      </component>

      <component
        :is="itemIs || 'li'"
        :class="itemClassFor(item, index)"
        :data-key="itemKey(item)"
        ref="$dndElements"
        @mousedown.stop="enableDrag"
        @mouseup.stop="disableDrag"
        @dragstart="itemDragStart($event, index)"
        @dragend="itemDragEnd"
        @dragenter="itemDragEnter($event, index)"
        @dragover="itemDragOver"
        @drop="doDrop"
      >
        <slot name="item" :item="item" />
      </component>
    </template>

    <component
      v-if="state.droppingToIndex !== undefined"
      :is="itemIs || 'li'"
      :style="state.droppingToIndex === displayItems.length && ghostStyle"
      :class="{
        // NOTE: This ghost must always be present when dropping into this list,
        // so we have a drop target at the end of the list.  Otherwise, it's
        // impossible for a user to drag a ghost to the end of the list unless
        // the list has some padding at the end.
        'dnd-list-ghost': true,
        'dropping-here': state.droppingToIndex === displayItems.length,
      }"
      @dragenter="ghostDragEnter($event, displayItems.length)"
      @dragover="ghostDragOver($event)"
      @drop="doDrop"
    >
      <slot name="ghost" />
    </component>
  </component>
</template>

<script lang="ts">
import {computed, nextTick, reactive, ref} from "vue";

import type {DragAction, DropAction} from "./dnd-list";

/** Reactive object describing the shared state of a <dnd-list>. */
type ListState<I = unknown> = {
  /** The DnD items that are actually in this list. */
  readonly modelValue: readonly I[];

  /** A snapshot of the model saved before beginning an actual drop operation,
   * which is shown to the user until the drop operation completes.  This
   * buffering ensures the user doesn't see any flickering during the drop. */
  modelSnapshot: undefined | readonly I[];

  /** If dragging from this list, this is the index of the dragged item.  Must
   * be set iff this ListState is the `sourceList`. */
  draggingFromIndex: number | undefined;

  /** If dropping into this list, this is the index of the drop location. Must
   * be set iff this ListState is the `destList`. */
  droppingToIndex: number | undefined;
};

//
// BEGIN UGLY GLOBAL STATE
//

// The source and destination lists of an in-progress drag operation (if any).
//
// NOTE: Source and destination may be the same list, and either source or
// destination may be null (the former, in particular, is possible when
// something is being dragged in from outside the app entirely).
//
// PERF: These must be non-reactive--that is, each list should only react to its
// own ListState, otherwise performans issues will result when there are many
// dnd-lists on the same page.
let sourceList: ListState | undefined = undefined;
let destList: ListState | undefined = undefined;

// An in-progress drop operation--once the user releases the mouse button, we
// start the async drop() function, and while it's running, this is set to the
// drop action.
let dropTask: DropAction | undefined = undefined;

// Reactive object that describes the width/height of the ghost, if required.
const ghostSize = ref(undefined as undefined | {width: number; height: number});
</script>

<script setup lang="ts" generic="I">
const props = defineProps<{
  is?: string;
  itemIs?: string;
  itemKey: (item: I) => string | number;
  itemClass?: (item: I, index: number) => Record<string, boolean>;
  accepts: string | readonly string[];
  modelValue: I[];

  drag: (drag: DragAction<I>) => void;
  drop: (drop: DropAction) => Promise<void>;

  /** When the ghost is displayed, does it cause items to change their positions
   * on the screen? */
  ghostDisplacesItems?: boolean;

  /** Should the ghost mimic the height of the item it's replacing? */
  ghostMimicsWidth?: boolean;

  /** Should the ghost mimic the width of the item it's replacing? */
  ghostMimicsHeight?: boolean;
}>();

const $top = ref(undefined! as HTMLElement);
const $dndElements = ref([] as HTMLElement[]);

/** State shared between dnd-list components so they can coordinate */
const state: ListState<I> = reactive({
  modelValue: computed(() => props.modelValue),
  modelSnapshot: undefined,
  draggingFromIndex: undefined,
  droppingToIndex: undefined,
});

const ghostStyle = computed((): string | undefined => {
  const s = ghostSize.value;
  if (!s) return undefined;

  let style = "";
  if (props.ghostMimicsWidth) style += `width: ${s.width}px; `;
  if (props.ghostMimicsHeight) style += `height: ${s.height}px; `;
  return style || undefined;
});

const displayItems = computed((): readonly I[] => {
  return state.modelSnapshot ?? props.modelValue;
});

function itemClassFor(item: I, index: number): Record<string, boolean> {
  const classes = props.itemClass ? props.itemClass(item, index) : {};
  classes.dragging = state.draggingFromIndex === index;
  return classes;
}

/** Given a DOM Event, locate the corresponding element in the DOM for
 * the DnD item. */
function dndElement(ev: Event): HTMLElement | undefined {
  if (!($dndElements.value instanceof Array)) return;
  let t = ev.target;
  while (t instanceof HTMLElement) {
    if ($dndElements.value.includes(t)) return t;
    t = t.parentElement;
  }
  return undefined;
}

/** We only set `draggable="true"` on the dragged element when we
 * actually want to start dragging.  This allows for children of the
 * draggable element to intercept mousedown events to prevent dragging,
 * so that such children can be interacted with. */
function enableDrag(ev: DragEvent) {
  const el = dndElement(ev);
  if (el) el.draggable = true;
}

/** Undo the effect of enableDrag() -- see that method for details. */
function disableDrag(ev: DragEvent) {
  const el = dndElement(ev);
  if (el) el.draggable = false;
}

/** Fired on the source location at the very beginning/end of the op */
function itemDragStart(ev: DragEvent, index: number) {
  const dndEl = dndElement(ev);

  // Now that the drag has started, undo the effect of enableDrag() as
  // explained there.
  disableDrag(ev);
  ev.stopPropagation();

  if (dropTask) {
    // Only one DnD operation is allowed at a time.
    ev.preventDefault();
    return;
  }

  props.drag({
    dataTransfer: ev.dataTransfer!,
    fromIndex: index,
    value: props.modelValue[index],
  });

  // setTimeout() to work around a Chrome bug described here:
  // https://stackoverflow.com/questions/19639969/html5-dragend-event-firing-immediately
  setTimeout(() => {
    if (!dndEl) return;

    const rect = dndEl.getBoundingClientRect();
    ghostSize.value = {width: rect.width, height: rect.height};

    state.draggingFromIndex = index;
    sourceList = state;
    state.droppingToIndex = index;
    destList = state;
  });
}

/** Fired on the source location at the end of a drag op (regardless of
 * whether it was committed or aborted). */
function itemDragEnd() {
  // If a drop operation is committed/in progress, we don't clear the
  // DND until it actually completes.
  if (dropTask) return;

  if (sourceList) sourceList.draggingFromIndex = undefined;
  sourceList = undefined;
  if (destList) destList.droppingToIndex = undefined;
  destList = undefined;

  ghostSize.value = undefined;
}

/** Fired when an item that is being dragged enters an element. */
function itemDragEnter(ev: DragEvent, index: number) {
  if (!allowDropHere(ev)) return;

  // Make the ghost mimic the size of the element it's about to enter,
  // as a way of debouncing.  This (mostly) guarantees that the ghost
  // will remain under the mouse cursor when it moves to its new
  // position, avoiding constant flickering/reshuffling if the ghost
  // enters/leaves a particular position as a result of the list being
  // re-flowed after moving the ghost.
  const el = dndElement(ev);
  if (el) {
    const rect = el.getBoundingClientRect();
    ghostSize.value = {width: rect.width, height: rect.height};
  }

  moveGhost(index);
}

/** Fired periodically while an element is being hovered over as a
 * potential drop target.  For stupid browser reasons, we must implement
 * both this AND dragEnter to let the browser know whether the element
 * is (still) a valid drop target. */
function itemDragOver(ev: DragEvent) {
  allowDropHere(ev); // called just for its side-effects
}

/** Special dragEnter events for parent items, which need different
 * behavior in Firefox because Firefox likes to fire these events even
 * when a child element should be consuming them instead... */
function parentDragEnter(ev: DragEvent) {
  if (!allowDropHere(ev)) return;
  if (ev.target && ev.target !== $top.value) return;
  moveGhost(displayItems.value.length);
}

/** Fired when an item is dragged away from the parent. */
function parentDragExit(ev: DragEvent) {
  // Ignore dragexit/dragleave events from our children; we only care about when
  // we leave the parent list.
  if (ev.target && ev.target !== $top.value) return;

  // If the user drags something completely out of the list, we don't want to
  // show a ghost at all. Clear the destination list.
  if (destList && destList !== state) {
    destList.droppingToIndex = undefined;
    destList = undefined;
  }
}

/** Fired on the "ghost" element when the cursor enters it (e.g. because
 * it was moved to be under the cursor, to indicate where the item will
 * be dropped). */
function ghostDragEnter(ev: DragEvent, index: number) {
  if (props.ghostDisplacesItems) {
    ev.preventDefault(); // allow dropping here
    ev.stopPropagation(); // consume the (potential) drop
  } else {
    itemDragEnter(ev, index);
  }
}

/** Fired on the "ghost" element repeatedly while the cursor is inside
 * it.  Just like itemDragOver(), we only want to spend enough time to
 * let the browser know this is a valid drop target.  (We determined
 * this earlier before moving the ghost into place.) */
function ghostDragOver(ev: DragEvent) {
  if (props.ghostDisplacesItems) {
    ev.preventDefault(); // allow dropping here
    ev.stopPropagation(); // consume the (potential) drop
  } else {
    itemDragOver(ev);
  }
}

/** Rejects the potential drop operation if this isn't a suitable
 * location for the drag that's in progress. */
function allowDropHere(ev: DragEvent): boolean {
  if (!ev.dataTransfer) return false;
  const types = ev.dataTransfer.types;
  if (props.accepts instanceof Array) {
    if (!types.find(t => props.accepts!.includes(t))) return false;
  } else if (props.accepts) {
    if (!types.includes(props.accepts)) return false;
  } else {
    return false;
  }
  ev.preventDefault();
  ev.stopPropagation();
  return true;
}

/** Moves the ghost to the specified location (sort of).  We want the
 * ghost to appear at `index`, which is presumed to be the location
 * currently under the mouse cursor.  (The actual index of the ghost may
 * vary depending on how it's being moved.) */
function moveGhost(index: number) {
  // NOTE: This is performance-critical code -- in particular,
  // updating `DND` in the wrong way may cause cascading unintended
  // updates across ALL <dnd-list> components in the page.

  if (state.droppingToIndex !== undefined && state.droppingToIndex <= index) {
    // If we are moving the ghost forward in the list from where it
    // currently is, we need to account for the fact that it's being
    // removed from its previous location, or it will appear at the
    // entry prior to where the mouse cursor actually is.
    if (props.ghostDisplacesItems) index++;
  }
  index = Math.min(index, displayItems.value.length);

  if (destList && destList !== state) {
    destList.droppingToIndex = undefined;
  }
  destList = state;
  state.droppingToIndex = index;
}

/** Fired when it's time to actually perform the drop operation. */
function doDrop(ev: DragEvent) {
  if (!allowDropHere(ev)) return;
  if (!destList) return;

  ev.stopPropagation();

  // Here we start the (async) drop task, and freeze the model in both
  // the source and destination lists until the drop task completes.
  // (We do this by taking a snapshot of the current modelValue and
  // storing it in modelSnapshot.) If we don't freeze the model, the
  // user will see a momentary flicker where the model(s) snap back to
  // the pre-drag state as both model values get updated.

  console.assert(destList === state);
  console.assert(destList.droppingToIndex !== undefined);

  const drop_ev: DropAction = {
    dataTransfer: ev.dataTransfer!,
    toIndex: destList.droppingToIndex!,
  };
  dropTask = drop_ev;

  if (sourceList) {
    sourceList.modelSnapshot = Array.from(sourceList.modelValue);
  }
  state.modelSnapshot = Array.from(props.modelValue);

  props
    .drop(drop_ev)
    .then(() => nextTick(), console.error) // wait for Vue model updates
    .finally(() => {
      if (sourceList) {
        sourceList.modelSnapshot = undefined;
        sourceList.draggingFromIndex = undefined;
        sourceList = undefined;
      }
      if (destList) {
        destList.modelSnapshot = undefined;
        destList.droppingToIndex = undefined;
        destList = undefined;
      }
      dropTask = undefined;
      ghostSize.value = undefined;
    });
}
</script>
