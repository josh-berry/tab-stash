import {Ref, computed} from "vue";

/** A model which allows for its elements to be selected must implement a few
 * things so that the selection model itself can report selected items in the
 * right order, select ranges of items, etc. */
export interface SelectableModel<T = any> {
    /** A Vue ref which reports how many items are selected. */
    selected_count: Ref<number>;

    /** Check the selection state of an item. */
    isSelected(item: T): boolean;

    /** Set the selection state of one or more items to `isSelected`.  (Note
     * that this function should NOT disturb the selection state of any items
     * not mentioned in `items`.) */
    setSelected(items: Iterable<T>, isSelected: boolean): Promise<void>;

    /** Yields the set of items which are selected, sorted appropriately
     * for how the items would be shown to the user. */
    selectedItems(): IterableIterator<T>;

    /** Given `start` and `end` items, if both items are part of the same
     * list/sequence, return a list of all the items in the range `[start,
     * end]`, inclusive.  Otherwise return null.
     *
     * NOTE: Since the caller has no idea where `start` and `end` are in
     * relation to each other, it may be that `end` appears in the model before
     * `start`.  This case must be handled as well. */
    itemsInRange(start: T, end: T): T[] | null;
}

/** Helper model to handle selecting/deselecting items in the UI.  This model
 * does not actually maintain selection state--that's done by setting/clearing a
 * special `$selected` property on model objects.
 *
 * It works across multiple models, so that it can keep global state about a
 * multi-selection operation (and avoid Vue components from having to do this).
 */
export class Model {
    readonly models: readonly SelectableModel[];

    readonly selected_count = computed(() => this.models
        .reduce((count, m) => count + m.selected_count.value, 0));

    /** The last item that was selected. */
    lastSelected?: {
        model: SelectableModel,
        item: any,

        /** The last multi-selection that was done (if any).  Stored so we can
         * clear a prior multi-selection if the user tries to adjust a
         * multi-select. */
        lastMultiSelect?: any[],
    };


    /** Construct a selection model, and provide the item models that can
     * participate in selection.  The item models should be passed in the order
     * they appear in the UI. */
    constructor(models: SelectableModel[]) {
        this.models = Array.from(models);
    }

    /** Clear all selections.  Returns the number of items that were
     * de-selected. */
    async clearSelection(): Promise<number> {
        let count = 0;
        const ps = [];
        this.lastSelected = undefined;
        for (const m of this.models) {
            const unselect = Array.from(m.selectedItems());
            ps.push(m.setSelected(unselect, false));
            count += unselect.length;
        }
        await Promise.all(ps);
        return count;
    }

    async toggleSelectFromEvent(ev: MouseEvent, model: SelectableModel, item: any) {
        if (ev.shiftKey) return this.toggleSelectRange(model, item);
        if (ev.ctrlKey || ev.metaKey) return this.toggleSelectOne(model, item);
        return this.toggleSelectScattered(model, item);
    }

    /** Analogous to a regular click--select a single item.  If any other items
     * were selected before, de-select them.  If only `item` is selected,
     * de-select it. */
    async toggleSelectOne(model: SelectableModel, item: any) {
        const wasSelected = model.isSelected(item);
        const selectCount = await this.clearSelection();

        // We clear lastSelected here because we are basically clearing the
        // entire set of selected items, thus resetting the selection state.  If
        // the user tries to select anything again, we should not remember what
        // they had deselected before (or they might get a surprising range of
        // items selected).
        this.lastSelected = undefined;
        if (selectCount == 1 && wasSelected) return;

        await model.setSelected([item], true);
        this.lastSelected = {model, item};
    }

    /** Toggle selection on a single item, regardless of what else is selected.
     * Analogous to a Ctrl+Click or Cmd+Click. */
    async toggleSelectScattered(model: SelectableModel, item: any) {
        await model.setSelected([item], ! model.isSelected(item));
        this.lastSelected = {model, item};
    }

    /** Select a range of items (if possible), analogous to Shift+Click.  All
     * items between lastSelected and the passed-in item will be toggled. */
    async toggleSelectRange(model: SelectableModel, item: any) {
        if (! this.lastSelected || this.lastSelected.model !== model) {
            return await this.toggleSelectScattered(model, item);
        }

        const range = model.itemsInRange(this.lastSelected.item, item);
        if (! range) {
            return await this.toggleSelectScattered(model, item);
        }

        const selected = model.isSelected(this.lastSelected.item);

        if (this.lastSelected.lastMultiSelect) {
            // If the last operation was itself a multi-select, de-select
            // anything that is not part of the new range, since the user is
            // probably adjusting their selection.
            const deselect = new Set(this.lastSelected.lastMultiSelect);
            for (const i of range) deselect.delete(i);
            await model.setSelected(deselect, ! selected);
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
