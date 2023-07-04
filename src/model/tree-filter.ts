import {computed, reactive, type Ref} from "vue";

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

/** A Tree whose nodes have been filtered by a predicate function. */
export class TreeFilter<P extends TreeParent<P, N>, N extends TreeNode<P, N>> {
  /** Check if a particular node is a parent node or not. */
  readonly isParent: IsParentFn<P, N>;

  /** The predicate function used to determine whether a node `isMatching` or
   * not.  Updating this ref will update the `.isMatching` property on every
   * node. */
  readonly predicate: Ref<(node: P | N) => boolean>;

  private readonly nodes = new WeakMap<P | N, FilterInfo>();

  constructor(
    isParent: IsParentFn<P, N>,
    predicate: Ref<(node: P | N) => boolean>,
  ) {
    this.isParent = isParent;
    this.predicate = predicate;
  }

  /** Returns a FilterInfo object describing whether this node (and/or its
   * sub-tree) matches the predicate or not. */
  info(node: P | N): FilterInfo {
    const n = this.nodes.get(node);
    if (n) return n;

    const isParent = this.isParent(node);

    const isMatching = computed(() => this.predicate.value(node));

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
