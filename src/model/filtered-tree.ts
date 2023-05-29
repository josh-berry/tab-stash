import {computed, ref, shallowReadonly, watchEffect} from "vue";

import type {Position, Tree} from "./tree";

export type FilteredItem<P extends object, C extends object> =
  | FilteredParent<P, C>
  | FilteredChild<C>;

export type FilteredParent<P extends object, C extends object> = {
  /** The underlying tree node. */
  readonly unfiltered: P;

  /** All the direct children of this node, wrapped in FilteredItem objects. */
  readonly children: readonly FilteredItem<P, C>[];

  /** Does this node match the predicate function? */
  readonly isMatching: boolean;

  /** Do any of the nodes in this node's sub-tree match the predicate? */
  readonly hasMatchingChildren: boolean;

  /** How many direct children of this node do not match the predicate? */
  readonly filteredCount: number;
};

export type FilteredChild<C extends object> = {
  /** The underlying tree node. */
  readonly unfiltered: C;

  /** Does this node match the predicate function? */
  readonly isMatching: boolean;
};

/** A Tree whose nodes have been filtered by a predicate function. */
export class FilteredTree<P extends object, C extends object>
  implements Tree<FilteredParent<P, C>, FilteredChild<C>>
{
  /** The underlying tree. */
  readonly tree: Tree<P, C>;

  /** The predicate function.  This function is called from within a Vue
   * computed() context, so if the predicate function relies on any reactive
   * values to compute the result, it will automatically be re-run when those
   * values change. */
  readonly predicate: (node: P | C) => boolean;

  private readonly nodes = new WeakMap<P | C, FilteredItem<P, C>>();

  constructor(tree: Tree<P, C>, predicate: (node: P | C) => boolean) {
    this.tree = tree;
    this.predicate = predicate;
  }

  isParent(
    node: FilteredParent<P, C> | FilteredChild<C>,
  ): node is FilteredParent<P, C> {
    return this.tree.isParent(node.unfiltered);
  }

  positionOf(
    node: FilteredParent<P, C> | FilteredChild<C>,
  ): Position<FilteredParent<P, C>> | undefined {
    const pos = this.tree.positionOf(node.unfiltered);
    if (!pos) return undefined;
    return {parent: this.wrappedParent(pos?.parent), index: pos.index};
  }

  childrenOf(
    parent: FilteredParent<P, C>,
  ): readonly (FilteredParent<P, C> | FilteredChild<C>)[] {
    return this.tree
      .childrenOf(parent.unfiltered)
      .map(i => this.wrappedNode(i));
  }

  /** Given a node from the underlying tree, wrap it in a FilteredItem. */
  wrappedNode(unfiltered: P | C): FilteredItem<P, C> {
    return this.tree.isParent(unfiltered)
      ? this.wrappedParent(unfiltered)
      : this.wrappedChild(unfiltered);
  }

  /** Given a parent node from the underlying tree, wrap it in a FilteredParent. */
  wrappedParent(unfiltered: P): FilteredParent<P, C> {
    const w = this.nodes.get(unfiltered);
    if (w) return w as FilteredParent<P, C>;

    const children = computed(() =>
      this.tree.childrenOf(unfiltered).map(i => this.wrappedNode(i)),
    );

    // PERF: We don't use computed() here because we have to recompute
    // isMatching for the whole tree every time the predicate changes, and this
    // can have a huge cascading effect downstream--instead, we only want to
    // write to isMatching when the value actually changes, to avoid triggering
    // re-renders unnecessarily.
    const isMatching = ref(this.predicate(unfiltered));
    watchEffect(() => {
      const res = this.predicate(unfiltered);
      if (isMatching.value !== res) isMatching.value = res;
    });

    const hasMatchingChildren = computed(
      () =>
        !!children.value.find(
          i => i.isMatching || (this.isParent(i) && i.hasMatchingChildren),
        ),
    );
    const filteredCount = computed(() => {
      let count = 0;
      children.value.forEach(i => {
        if (!i.isMatching) ++count;
      });
      return count;
    });

    // Ugh, I wish shallowReadonly() actually unwrapped the top-level refs...
    const p = shallowReadonly({
      unfiltered,
      get isMatching() {
        return isMatching.value;
      },
      get hasMatchingChildren() {
        return hasMatchingChildren.value;
      },
      get children() {
        return children.value;
      },
      get filteredCount() {
        return filteredCount.value;
      },
    });
    this.nodes.set(unfiltered, p);
    return p;
  }

  /** Given a child node from the underlying tree, wrap it in a FilteredChild. */
  wrappedChild(unfiltered: C): FilteredChild<C> {
    const w = this.nodes.get(unfiltered);
    if (w) return w as FilteredChild<C>;

    // PERF: We don't use computed() here because we have to recompute
    // isMatching for the whole tree every time the predicate changes, and this
    // can have a huge cascading effect downstream--instead, we only want to
    // write to isMatching when the value actually changes, to avoid triggering
    // re-renders unnecessarily.
    const isMatching = ref(this.predicate(unfiltered));
    watchEffect(() => {
      const res = this.predicate(unfiltered);
      if (isMatching.value !== res) isMatching.value = res;
    });

    // Ugh, I wish shallowReadonly() actually unwrapped the top-level refs...
    const c = shallowReadonly({
      unfiltered,
      get isMatching() {
        return isMatching.value;
      },
    });
    this.nodes.set(unfiltered, c);
    return c;
  }
}
