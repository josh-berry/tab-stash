import type {Directive} from "vue";

import {
  makeDraggable,
  makeDroppable,
  type DNDLifecycle,
  type DraggableOptions,
  type DroppableOptions,
} from "./dnd.js";

const draggableElements = new WeakMap<
  HTMLElement,
  DNDLifecycle<DraggableOptions>
>();
const droppableElements = new WeakMap<
  HTMLElement,
  DNDLifecycle<DroppableOptions>
>();

export const vDraggable: Directive<
  HTMLElement,
  DraggableOptions,
  never,
  never
> = {
  mounted(el, binding) {
    draggableElements.set(el, makeDraggable(el, binding.value));
  },
  updated(el, binding) {
    const l = draggableElements.get(el);
    if (l) l.update(binding.value);
  },
  unmounted(el) {
    const l = draggableElements.get(el);
    if (l) l.cancel();
    draggableElements.delete(el);
  },
};

export const vDroppable: Directive<
  HTMLElement,
  DroppableOptions,
  never,
  never
> = {
  mounted(el, binding) {
    droppableElements.set(el, makeDroppable(el, binding.value));
  },
  updated(el, binding) {
    const l = droppableElements.get(el);
    if (l) l.update(binding.value);
  },
  unmounted(el) {
    const l = droppableElements.get(el);
    if (l) l.cancel();
    droppableElements.delete(el);
  },
};
