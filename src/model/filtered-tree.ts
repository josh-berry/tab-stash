import {computed, type ComputedRef} from "vue";

import type {Position, Tree} from "./tree";

export type FilteredItem<P extends object, C extends object> =
  | FilteredParent<P, C>
  | FilteredChild<C>;

export type FilteredParent<P extends object, C extends object> = {
  /** The underlying tree node. */
  readonly unfiltered: P;

  /** All the direct children of this node, wrapped in FilteredItem objects. */
  children: ComputedRef<FilteredItem<P, C>[]>;

  /** Does this node match the predicate function? */
  isMatching: ComputedRef<boolean>;

  /** Do any of the nodes in this node's sub-tree match the predicate? */
  hasMatchingChildren: ComputedRef<boolean>;

  /** How many direct children of this node do not match the predicate? */
  filteredCount: ComputedRef<number>;
};

export type FilteredChild<C extends object> = {
  /** The underlying tree node. */
  readonly unfiltered: C;

  /** Does this node match the predicate function? */
  isMatching: ComputedRef<boolean>;
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
  ): (FilteredParent<P, C> | FilteredChild<C>)[] {
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
    const isMatching = computed(() => this.predicate(unfiltered));
    const hasMatchingChildren = computed(
      () =>
        !!children.value.find(
          i =>
            i.isMatching.value ||
            (this.isParent(i) && i.hasMatchingChildren.value),
        ),
    );
    const filteredCount = computed(() => {
      let count = 0;
      children.value.forEach(i => {
        if (i.isMatching.value) ++count;
      });
      return count;
    });

    const p = {
      unfiltered,
      isMatching,
      hasMatchingChildren,
      children,
      filteredCount,
    };
    this.nodes.set(unfiltered, p);
    return p;
  }

  /** Given a child node from the underlying tree, wrap it in a FilteredChild. */
  wrappedChild(unfiltered: C): FilteredChild<C> {
    const w = this.nodes.get(unfiltered);
    if (w) return w as FilteredChild<C>;

    const c = {
      unfiltered,
      isMatching: computed(() => this.predicate(unfiltered)),
    };
    this.nodes.set(unfiltered, c);
    return c;
  }
}
