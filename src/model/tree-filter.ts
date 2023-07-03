import {computed, reactive} from "vue";

import {computedLazyEq} from "../util";
import type {IsParentFn, TreeNode, TreeParent} from "./tree";

export interface FilterInfo {
  /** Does this node match the predicate function? */
  readonly isMatching: boolean;

  /** Do any nodes in this node's sub-tree match the predicate? (Includes the
   * node itself.) */
  readonly hasMatchInSubtree: boolean;

  /** How many direct child nodes do NOT have a match in their subtree? (This is
   * useful for showing a "+ N filtered" number to users to indicate how many
   * items are hidden in the UI.) */
  readonly nonMatchingCount: number;
}

export interface FilteredTreeAccessors<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
> {
  /** Check if this node is a parent node or not. */
  isParent(node: P | N): node is P;

  /** The predicate function.  This function is called from within a Vue
   * computed() context, so if the predicate function relies on any reactive
   * values to compute the result, it will automatically be re-run when those
   * values change. */
  predicate(node: P | N): boolean;
}

/** A Tree whose nodes have been filtered by a predicate function. */
export class TreeFilter<P extends TreeParent<P, N>, N extends TreeNode<P, N>>
  implements FilteredTreeAccessors<P, N>
{
  readonly isParent: IsParentFn<P, N>;
  readonly predicate: (node: P | N) => boolean;

  private readonly nodes = new WeakMap<P | N, FilterInfo>();

  constructor(accessors: FilteredTreeAccessors<P, N>) {
    this.isParent = accessors.isParent;
    this.predicate = accessors.predicate;
  }

  /** Returns a FilterInfo object describing whether this node (and/or its
   * sub-tree) matches the predicate or not. */
  info(node: P | N): FilterInfo {
    const n = this.nodes.get(node);
    if (n) return n;

    const isParent = this.isParent(node);

    const isMatching = computed(() => this.predicate(node));

    const hasMatchInSubtree = isParent
      ? computedLazyEq(() => {
          if (isMatching.value) return true;
          for (const c of node.children) {
            if (this.info(c).hasMatchInSubtree) return true;
          }
          return false;
        })
      : isMatching;

    const nonMatchingCount = isParent
      ? computedLazyEq(() => {
          let count = 0;
          for (const c of node.children) {
            if (!this.info(c).hasMatchInSubtree) ++count;
          }
          return count;
        })
      : 0;

    const i: FilterInfo = reactive({
      isMatching,
      hasMatchInSubtree,
      nonMatchingCount,
    });

    this.nodes.set(node, i);
    return i;
  }
}
