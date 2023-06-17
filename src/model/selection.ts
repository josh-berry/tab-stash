import type {Ref} from "vue";

import {computedLazyEq} from "../util";

/** A model which allows for its elements to be selected must implement a few
 * things so that the selection model itself can report selected items in the
 * right order, select ranges of items, etc. */
export interface SelectableModel<T = any> {
  /** A Vue ref which reports how many items are selected. */
  selectedCount: Ref<number>;

  /** Check if an item is selected. */
  isSelected(item: T): boolean;

  /** Clear all selections (even on items invisible to the user). */
  clearSelection(): Promise<void>;

  /** Set the selection state of one or more items to `isSelected`.  (Note
   * that this function should NOT disturb the selection state of any items
   * not mentioned in `items`.)
   *
   * setSelected() should select the item regardless of whether it's visible
   * to the user or not. */
  setSelected(items: Iterable<T>, isSelected: boolean): Promise<void>;

  /** Yields the set of items which are selected, sorted appropriately for how
   * the items would be shown to the user.  The selected items returned should
   * *include* any items that are selected but invisible to the user. */
  selectedItems(): IterableIterator<T>;

  /** Given `start` and `end` items, if both items are part of the same
   * list/sequence, return a list of all the items in the range `[start,
   * end]`, inclusive.  Otherwise return null.
   *
   * Unlike the other methods on this interface, items which are invisible to
   * the user should be *omitted*, so the user does not select things which
   * they cannot see.
   *
   * NOTE: Since the caller has no idea where `start` and `end` are in
   * relation to each other, it may be that `end` appears in the model before
   * `start`.  This case must be handled as well. */
  itemsInRange(start: T, end: T): T[] | null;
}

/** Helper model to handle selecting/deselecting items in the UI.  This model
 * does not actually maintain selection state--that's done by calling
 * `setSelected()` on the SelectableModel.
 *
 * It works across multiple models, so that it can keep global state about a
 * multi-selection operation (and avoid Vue components from having to do this).
 */
export class Model {
  readonly models: readonly SelectableModel[];

  readonly selectedCount: Ref<number>;

  /** The last item that was selected. */
  lastSelected?: {
    model: SelectableModel;
    item: any;

    /** The last multi-selection that was done (if any).  Stored so we can
     * clear a prior multi-selection if the user tries to adjust a
     * multi-select. */
    lastMultiSelect?: any[];
  };

  /** Construct a selection model, and provide the item models that can
   * participate in selection.  The item models should be passed in the order
   * they appear in the UI. */
  constructor(models: SelectableModel[]) {
    this.models = Array.from(models);
    this.selectedCount = computedLazyEq(() =>
      this.models.reduce((count, m) => count + m.selectedCount.value, 0),
    );
  }

  /** Clear all selections, including any that may not be visible to the user.
   * This should reset the model back to a clean slate where absolutely
   * nothing is selected anywhere (filtered or otherwise). */
  async clearSelection(): Promise<void> {
    this.lastSelected = undefined;
    await Promise.all(this.models.map(m => m.clearSelection()));
  }

  // istanbul ignore next -- This just dispatches on a DOM event, which is
  // hard to test for without actual DOM events.
  async toggleSelectFromEvent(
    ev: MouseEvent,
    model: SelectableModel,
    item: any,
  ) {
    if (ev.shiftKey) return this.toggleSelectRange(model, item);
    if (ev.ctrlKey || ev.metaKey) return this.toggleSelectOne(model, item);
    return this.toggleSelectScattered(model, item);
  }

  /** Analogous to a regular click--select a single item.  If any other items
   * were selected before, de-select them.  If only `item` is selected,
   * de-select it. */
  async toggleSelectOne(model: SelectableModel, item: any) {
    const wasSelected = model.isSelected(item);
    const selectCount = this.selectedCount.value;
    await this.clearSelection();

    if (selectCount == 1 && wasSelected) return;

    await model.setSelected([item], true);
    this.lastSelected = {model, item};
  }

  /** Toggle selection on a single item, regardless of what else is selected.
   * Analogous to a Ctrl+Click or Cmd+Click. */
  async toggleSelectScattered(model: SelectableModel, item: any) {
    await model.setSelected([item], !model.isSelected(item));
    this.lastSelected = {model, item};
  }

  /** Select a range of items (if possible), analogous to Shift+Click.  All
   * items between lastSelected and the passed-in item will be toggled. */
  async toggleSelectRange(model: SelectableModel, item: any) {
    if (!this.lastSelected || this.lastSelected.model !== model) {
      return await this.toggleSelectScattered(model, item);
    }

    const range = model.itemsInRange(this.lastSelected.item, item);
    if (!range) {
      return await this.toggleSelectScattered(model, item);
    }

    const selected = model.isSelected(this.lastSelected.item);

    if (this.lastSelected.lastMultiSelect) {
      // If the last operation was itself a multi-select, de-select
      // anything that is not part of the new range, since the user is
      // probably adjusting their selection.
      const deselect = new Set(this.lastSelected.lastMultiSelect);
      for (const i of range) deselect.delete(i);
      await model.setSelected(deselect, !selected);
    }

    // Now, select anything that wasn't selected already.
    const select = new Set(range);
    if (this.lastSelected.lastMultiSelect) {
      for (const i of this.lastSelected.lastMultiSelect) select.delete(i);
    }

    this.lastSelected.lastMultiSelect = range;
    await model.setSelected(select, selected);
  }
}
