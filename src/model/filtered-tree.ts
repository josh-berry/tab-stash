import {computed, shallowReadonly} from "vue";

import {computedLazyEq} from "../util";
import type {TreeNode, TreeParent} from "./tree";

export type FilteredItem<
  P extends TreeParent<P, C>,
  C extends TreeNode<P, C>,
> = FilteredParent<P, C> | FilteredChild<P, C>;

export interface FilteredParent<
  P extends TreeParent<P, C>,
  C extends TreeNode<P, C>,
> extends TreeParent<FilteredParent<P, C>, FilteredChild<P, C>>,
    TreeNode<FilteredParent<P, C>, FilteredChild<P, C>> {
  /** The underlying tree node. */
  readonly unfiltered: P;

  /** Does this node match the predicate function? */
  readonly isMatching: boolean;

  /** Do any of the nodes in this node's sub-tree match the predicate? */
  readonly hasMatchingChildren: boolean;

  /** How many direct children of this node do not match the predicate? */
  readonly filteredCount: number;
}

export interface FilteredChild<
  P extends TreeParent<P, C>,
  C extends TreeNode<P, C>,
> extends TreeNode<FilteredParent<P, C>, FilteredChild<P, C>> {
  /** The underlying tree node. */
  readonly unfiltered: C;

  /** Does this node match the predicate function? */
  readonly isMatching: boolean;
}

export interface FilteredTreeAccessors<
  P extends TreeParent<P, C>,
  C extends TreeNode<P, C>,
> {
  /** Check if this node is a parent node or not. */
  isParent(node: P | C): node is P;

  /** The predicate function.  This function is called from within a Vue
   * computed() context, so if the predicate function relies on any reactive
   * values to compute the result, it will automatically be re-run when those
   * values change. */
  predicate(node: P | C): boolean;
}

export function isFilteredParent<
  P extends TreeParent<P, C>,
  C extends TreeNode<P, C>,
>(
  node: FilteredParent<P, C> | FilteredChild<P, C>,
): node is FilteredParent<P, C> {
  return "children" in node;
}

/** A Tree whose nodes have been filtered by a predicate function. */
export class FilteredTree<P extends TreeParent<P, C>, C extends TreeNode<P, C>>
  implements FilteredTreeAccessors<P, C>
{
  readonly isParent: (node: P | C) => node is P;
  readonly predicate: (node: P | C) => boolean;

  private readonly nodes = new WeakMap<P | C, FilteredItem<P, C>>();

  constructor(accessors: FilteredTreeAccessors<P, C>) {
    this.isParent = accessors.isParent;
    this.predicate = accessors.predicate;
  }

  /** Given a node from the underlying tree, wrap it in a FilteredItem. */
  wrappedNode(unfiltered: P | C): FilteredItem<P, C> {
    return this.isParent(unfiltered)
      ? this.wrappedParent(unfiltered)
      : this.wrappedChild(unfiltered);
  }

  /** Given a parent node from the underlying tree, wrap it in a FilteredParent. */
  wrappedParent(unfiltered: P): FilteredParent<P, C> {
    const w = this.nodes.get(unfiltered);
    if (w) return w as FilteredParent<P, C>;

    const position = computed(() => {
      const pos = unfiltered.position;
      if (!pos) return undefined;
      return {parent: this.wrappedParent(pos.parent), index: pos.index};
    });

    const children = computed(() =>
      unfiltered.children.map(i => this.wrappedNode(i)),
    );

    // PERF: We don't use computed() here because we have to recompute
    // isMatching for the whole tree every time the predicate changes, and this
    // can have a huge cascading effect downstream--instead, we only want to
    // write to isMatching when the value actually changes, to avoid triggering
    // re-renders unnecessarily.
    const isMatching = computedLazyEq(() => this.predicate(unfiltered));

    const hasMatchingChildren = computedLazyEq(
      () =>
        !!children.value.find(
          i =>
            i.isMatching ||
            ("hasMatchingChildren" in i && i.hasMatchingChildren),
        ),
    );
    const filteredCount = computedLazyEq(() => {
      let count = 0;
      children.value.forEach(i => {
        if (!i.isMatching) ++count;
      });
      return count;
    });

    // Ugh, I wish shallowReadonly() actually unwrapped the top-level refs...
    const p = shallowReadonly({
      unfiltered,
      get position() {
        return position.value;
      },
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
  wrappedChild(unfiltered: C): FilteredChild<P, C> {
    const w = this.nodes.get(unfiltered);
    if (w) return w as FilteredChild<P, C>;

    const position = computed(() => {
      // istanbul ignore next -- trivial case for singleton nodes
      if (!unfiltered.position) return undefined;
      return {
        parent: this.wrappedParent(unfiltered.position.parent),
        index: unfiltered.position.index,
      };
    });

    // PERF: We don't use computed() here because we have to recompute
    // isMatching for the whole tree every time the predicate changes, and this
    // can have a huge cascading effect downstream--instead, we only want to
    // write to isMatching when the value actually changes, to avoid triggering
    // re-renders unnecessarily.
    const isMatching = computedLazyEq(() => this.predicate(unfiltered));

    // Ugh, I wish shallowReadonly() actually unwrapped the top-level refs...
    const c = shallowReadonly({
      unfiltered,
      get position() {
        return position.value;
      },
      get isMatching() {
        return isMatching.value;
      },
    });
    this.nodes.set(unfiltered, c);
    return c;
  }
}
