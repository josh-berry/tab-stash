/** The visual orientation of an element that can be a drop target.  The
 * position of the mouse cursor inside the drop target is used to determine
 * whether an item should be dropped `before`, `inside` or `after` the drop
 * target itself.
 *
 * - For `vertical` orientation, dropping in the top part of the element means
 *   `before`, and in the bottom part of the element means `after`.
 * - For `horizontal` orientation, dropping left/right means `before`/`after`.
 *
 * For grids, we recommend using the orientation that adjacent items follow--for
 * example, a flexbox grid that puts adjacent items next to each other
 * horizontally should use `horizontal`. (This is most common.) If items are
 * stacked vertically first, and then a new column is started only after the
 * first column is filled (as if reading a newspaper), then the `vertical`
 * orientation should be used. */
export type DNDOrientation = "vertical" | "horizontal";

/** The drop position relative to the drop target. The dragged item should be
 * inserted `before`, `inside` or `after` the drop target. */
export type DNDDropPosition = "before" | "inside" | "after";

/** Where should dropped item(s) be inserted, relative to this item? Dropped
 * items can be inserted adjacent to this item (`before` and/or `after`), and/or
 * `inside` this item (e.g. as a child). `null` means a drop is not allowed
 * here. */
export type DNDAcceptedDropPositions =
  | DNDDropPosition
  | "before-after"
  | "before-inside"
  | "inside-after"
  | "before-inside-after"
  | null;

/** An event that's fired on the drop target when the user completes a drop. */
export interface DropEvent {
  /** Data describing the dragged item(s). */
  data: DataTransfer;

  /** The position the dropped item should take relative to the drop target. */
  position: DNDDropPosition;
}

export interface DraggableOptions {
  /** Fired when the user starts to drag this item. The callee must fill in the
   * DataTransfer object with info about the dragged item. */
  start(data: DataTransfer): void;

  /** Fired when this item is no longer being dragged, regardless of whether the
   * drop was completed or cancelled. */
  end?: () => void;
}

export interface DroppableOptions {
  /** The visual orientation of this drop target.  See DNDOrientation. */
  orientation: () => DNDOrientation;

  /** Validator that returns the allowed drop positions for the data contained
   * in the provided DataTransfer.  Return `null` if a drop should not be
   * accepted. */
  accepts(data: DataTransfer): DNDAcceptedDropPositions;

  /** Fired when something previously-validated by `allowsDrop()` is dropped on
   * this item. */
  drop(event: DropEvent): void;
}

export interface DNDLifecycle<Options> {
  update(options: Options): void;
  cancel(): void;
}

// This is an ugly bit of global state to allow different drop targets to
// coordinate with each other about drag-and-drop events. Firefox sometimes
// just... doesn't fire dragleave events for some reason, so there's no reliable
// way to know when a dragged item is no longer in its drop target. Sigh.
let resetDragStateHook = () => {};

// Used by the drop code math to determine the drop position.
const POSITIONS: DNDDropPosition[] = ["before", "inside", "after"];

/** Registers a hook for other drop targets to be able to call us back when our
 * drag state should be cleared (e.g. because the drop target has changed, but
 * we never got a notification from Firefox).
 *
 * Only one item can be a drop target at a time, so this always clears the
 * drag state of the prior item before registering our hook. */
function resetDragState(onNextReset: () => void) {
  resetDragStateHook();
  resetDragStateHook = onNextReset;
}

/** Sets up the provided DOM element to be draggable.  Attaches `mousedown`,
 * `mouseup`, `dragstart`, `dragend` event handlers to the element.
 *
 * Elements which may be dragged will have the `draggable` attribute set.
 * Elements which are actively being dragged will have the `data-dnd-dragging`
 * attribute set so they may be styled accordingly.
 */
export function makeDraggable(
  $el: HTMLElement,
  options: DraggableOptions,
): DNDLifecycle<DraggableOptions> {
  $el.addEventListener("mousedown", onMouseDown);
  $el.addEventListener("mouseup", onMouseUp);
  $el.addEventListener("dragstart", onDragStart);
  $el.addEventListener("dragend", onDragEnd);

  function update(newOptions: DraggableOptions) {
    options = newOptions;
  }

  function cancel() {
    $el.removeAttribute("draggable");
    delete $el.dataset.dndDragging;
    $el.removeEventListener("mousedown", onMouseDown);
    $el.removeEventListener("mouseup", onMouseUp);
    $el.removeEventListener("dragstart", onDragStart);
    $el.removeEventListener("dragend", onDragEnd);
  }

  function onMouseDown(ev: MouseEvent) {
    $el.setAttribute("draggable", "true");
    ev.stopPropagation();
  }

  function onMouseUp(ev: MouseEvent) {
    $el.removeAttribute("draggable");
    ev.stopPropagation();
  }

  function onDragStart(ev: DragEvent) {
    if (!ev.dataTransfer) return;
    ev.stopPropagation();
    $el.removeAttribute("draggable");
    $el.dataset.dndDragging = "true";
    options.start(ev.dataTransfer);
  }

  function onDragEnd(ev: DragEvent) {
    resetDragState(() => {});
    $el.removeAttribute("draggable");
    delete $el.dataset.dndDragging;
    if (options.end) options.end();
  }

  return {update, cancel};
}

/** Sets up the provided DOM element to accept drops. Attaches `dragenter`,
 * `dragover`, `dragleave`, and `drop` event handlers to the element.
 *
 * Elements which are being dragged over (/are the current drop target) will
 * have the `data-dnd-dropping` attribute set to `before`, `inside`, or `after`,
 * depending on the desired drop position.  This can be used for styling (e.g.
 * showing some indication of where the dragged item will be dropped). */
export function makeDroppable(
  $el: HTMLElement,
  options: DroppableOptions,
): DNDLifecycle<DroppableOptions> {
  $el.addEventListener("dragenter", onDragEnter);
  $el.addEventListener("dragover", onDragOver);
  $el.addEventListener("dragleave", onDragLeave);
  $el.addEventListener("drop", onDrop);

  function update(newOptions: DroppableOptions) {
    options = newOptions;
  }

  function cancel() {
    delete $el.dataset.dndDropping;
    $el.removeEventListener("dragenter", onDragEnter);
    $el.removeEventListener("dragover", onDragOver);
    $el.removeEventListener("dragleave", onDragLeave);
    $el.removeEventListener("drop", onDrop);
  }

  function onDragEnter(ev: DragEvent) {
    const position = getDropPosition(ev);
    if (!position) return;

    resetDragState(() => {
      delete $el.dataset.dndDropping;
    });
    $el.dataset.dndDropping = position;
  }

  function onDragOver(ev: DragEvent) {
    onDragEnter(ev);
  }

  function onDragLeave(ev: DragEvent) {
    delete $el.dataset.dndDropping;
  }

  function onDrop(ev: DragEvent) {
    const position = getDropPosition(ev);
    if (!position) return;

    resetDragState(() => {});
    // CAST: We know the dataTransfer exists b/c getDropPosition() checks it.
    options.drop({data: ev.dataTransfer!, position});
  }

  /** Given a drag event, determine where the item should be dropped (and if
   * it can be dropped in this drop target at all). */
  function getDropPosition(ev: DragEvent): DNDDropPosition | undefined {
    if (!ev.dataTransfer) return undefined;
    const allowedPositions = options.accepts(ev.dataTransfer);
    if (!allowedPositions) return undefined;
    ev.stopPropagation();
    ev.preventDefault();

    return dropPosImpls[options.orientation()][allowedPositions]($el, ev);
  }

  return {update, cancel};
}

const dropPosImpls = {
  vertical: {
    before: (_h: HTMLElement, _e: DragEvent) => "before" as DNDDropPosition,
    inside: (_h: HTMLElement, _e: DragEvent) => "inside" as DNDDropPosition,
    after: (_h: HTMLElement, _e: DragEvent) => "after" as DNDDropPosition,
    "before-after"(el: HTMLElement, ev: DragEvent): DNDDropPosition {
      const elSize = el.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientY - elSize.y)) / elSize.height);
      return POSITIONS[slice * 2];
    },
    "before-inside"(el: HTMLElement, ev: DragEvent): DNDDropPosition {
      const elSize = el.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientY - elSize.y)) / elSize.height);
      return POSITIONS[slice];
    },
    "inside-after"(el: HTMLElement, ev: DragEvent): DNDDropPosition {
      const elSize = el.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientY - elSize.y)) / elSize.height);
      return POSITIONS[slice + 1];
    },
    "before-inside-after"(el: HTMLElement, ev: DragEvent): DNDDropPosition {
      const elSize = el.getBoundingClientRect();
      const slice = Math.floor((3 * (ev.clientY - elSize.y)) / elSize.height);
      return POSITIONS[slice];
    },
  },
  horizontal: {
    before: (_h: HTMLElement, _e: DragEvent) => "before" as DNDDropPosition,
    inside: (_h: HTMLElement, _e: DragEvent) => "inside" as DNDDropPosition,
    after: (_h: HTMLElement, _e: DragEvent) => "after" as DNDDropPosition,
    "before-after"(el: HTMLElement, ev: DragEvent): DNDDropPosition {
      const elSize = el.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientX - elSize.x)) / elSize.width);
      return POSITIONS[slice * 2];
    },
    "before-inside"(el: HTMLElement, ev: DragEvent): DNDDropPosition {
      const elSize = el.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientX - elSize.x)) / elSize.width);
      return POSITIONS[slice];
    },
    "inside-after"(el: HTMLElement, ev: DragEvent): DNDDropPosition {
      const elSize = el.getBoundingClientRect();
      const slice = Math.floor((2 * (ev.clientX - elSize.x)) / elSize.width);
      return POSITIONS[slice + 1];
    },
    "before-inside-after"(el: HTMLElement, ev: DragEvent): DNDDropPosition {
      const elSize = el.getBoundingClientRect();
      const slice = Math.floor((3 * (ev.clientX - elSize.x)) / elSize.width);
      return POSITIONS[slice];
    },
  },
};
