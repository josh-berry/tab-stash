import {computed, reactive, ref, type Ref} from "vue";

import {computedLazyEq} from "../util";
import {
  forEachNodeInSubtree,
  type IsParentFn,
  type TreeNode,
  type TreeParent,
} from "./tree";

export interface SelectionInfo {
  /** Is this node selected? */
  isSelected: boolean;

  /** How many nodes in this subtree are selected, including ourselves?
   *
   * (Note that this is eventually-consistent--it may not update until after the
   * next round through the event loop.) */
  readonly selectedCount: number;

  /** Does this subtree have any nodes selected anywhere within it (including
   * itself)?
   *
   * This exists as a performance optimization--using this property will trigger
   * fewer updates than doing a check like `selectedCount !== 0`.
   *
   * (Note that this is eventually-consistent--it may not update until after the
   * next round through the event loop.)
   */
  readonly hasSelectionInSubtree: boolean;
}

export class TreeSelection<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
> {
  readonly isParent: IsParentFn<P, N>;

  /** The roots of the tree, mainly used to calculate the count of selected
   * nodes. */
  readonly roots: Ref<P[]>;

  /** An optional predicate function used to filter items from range selections. */
  rangeSelectPredicate?: (n: P | N) => boolean;

  /** How many nodes are selected in `this.roots` and their subtrees? */
  readonly selectedCount: Ref<number>;

  /** The last selection that was done. */
  lastSelected?: {
    /** The last item that was clicked on, either as part of a single-item
     * selection or a range selection. */
    node: P | N;

    /** The last range selection that was done; stored so we can adjust the
     * range on subsequent range-select actions. */
    range?: (P | N)[];
  };

  private readonly nodes = new WeakMap<P | N, SelectionInfo>();

  constructor(isParent: IsParentFn<P, N>, roots: Ref<P[]>) {
    this.isParent = isParent;
    this.roots = roots;
    this.selectedCount = computedLazyEq(() =>
      this.roots.value.reduce(
        (sum, root) => sum + this.info(root).selectedCount,
        0,
      ),
    );
  }

  info(node: P | N): SelectionInfo {
    const n = this.nodes.get(node);
    if (n) return n;

    const isParent = this.isParent(node);

    const isSelected = ref(false);

    const selectedCount = isParent
      ? computedLazyEq(() => {
          let count = isSelected.value ? 1 : 0;
          for (const c of node.children) {
            const info = this.info(c);
            count += info.selectedCount;
          }
          return count;
        })
      : computed(() => (isSelected.value ? 1 : 0));

    const hasSelectionInSubtree = isParent
      ? computedLazyEq(() => selectedCount.value !== 0)
      : isSelected;

    const i: SelectionInfo = reactive({
      isSelected,
      selectedCount,
      hasSelectionInSubtree,
    });

    this.nodes.set(node, i);
    return i;
  }

  *selectedItems(): Generator<P | N> {
    for (const n of this.roots.value) yield* this.selectedItemsInSubtree(n);
  }

  *selectedItemsInSubtree(node: P | N): Generator<P | N> {
    if (this.info(node).isSelected) yield node;
    if (!this.isParent(node)) return;

    // NOTE: We could optimize this by checking `hasSelectionInSubtree`,
    // however, that property is eventually-consistent and we want stronger
    // consistency here until we see that it's actually a performance issue.
    for (const c of node.children) yield* this.selectedItemsInSubtree(c);
  }

  /** Set all `node.isSelected` properties to false within `this.roots`. */
  clearSelection(): void {
    this.lastSelected = undefined;
    for (const r of this.roots.value) {
      forEachNodeInSubtree(r, this.isParent, n => {
        this.info(n).isSelected = false;
      });
    }
  }

  /** Trigger a selection action based on a DOM event. */
  toggleSelectFromEvent(ev: MouseEvent, node: P | N) {
    if (ev.shiftKey) return this.toggleSelectRange(node);
    if (ev.ctrlKey || ev.metaKey) return this.toggleSelectOne(node);
    return this.toggleSelectScattered(node);
  }

  /** Analogous to a regular click--select a single item.  If any other items
   * were selected before, de-select them.  If only `item` is selected,
   * de-select it. */
  toggleSelectOne(node: P | N) {
    const ni = this.info(node);
    const wasSelected = ni.isSelected;
    const selectCount = this.selectedCount.value;
    this.clearSelection();

    if (selectCount == 1 && wasSelected) return;

    ni.isSelected = true;
    this.lastSelected = {node};
  }

  /** Toggle selection on a single item, regardless of what else is selected.
   * Analogous to a Ctrl+Click or Cmd+Click. */
  toggleSelectScattered(node: P | N) {
    const ni = this.info(node);
    ni.isSelected = !ni.isSelected;
    this.lastSelected = {node};
  }

  /** Select a range of items (if possible), analogous to Shift+Click.  All
   * items between lastSelected and the passed-in item will be toggled. */
  toggleSelectRange(node: P | N) {
    if (!this.lastSelected) {
      return this.toggleSelectScattered(node);
    }

    let range = this.itemsInRange(this.lastSelected.node, node);
    if (!range) {
      return this.toggleSelectScattered(node);
    }
    range = range.filter(this.rangeSelectPredicate || (_ => true));

    const selected = this.info(this.lastSelected.node).isSelected;

    if (this.lastSelected.range) {
      // If the last operation was itself a multi-select, de-select
      // anything that is not part of the new range, since the user is
      // probably adjusting their selection.
      const deselect = new Set(this.lastSelected.range);
      for (const i of range) deselect.delete(i);
      for (const n of deselect) this.info(n).isSelected = !selected;
    }

    // Now, select anything that wasn't selected already.
    const select = new Set(range);
    if (this.lastSelected.range) {
      for (const i of this.lastSelected.range) select.delete(i);
    }

    this.lastSelected.range = range;
    for (const n of select) this.info(n).isSelected = selected;
  }

  // TODO Move me into tree.ts and find common parents
  itemsInRange(start: P | N, end: P | N): (P | N)[] | undefined {
    let startPos = start.position;
    let endPos = end.position;

    if (!startPos || !endPos) return undefined;
    if (startPos.parent !== endPos.parent) return undefined;

    if (endPos.index < startPos.index) {
      const tmp = endPos;
      endPos = startPos;
      startPos = tmp;
    }

    return startPos.parent.children.slice(startPos.index, endPos.index + 1);
  }
}
