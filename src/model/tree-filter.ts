import {computed, reactive, type Ref} from "vue";

import type {Tree} from "./tree.js";

export interface FilterInfo {
  /** Does this node match the predicate function? */
  readonly isMatching: boolean;

  /** Do any nodes in this node's sub-tree match the predicate? (Excludes the
   * node itself.) If the node is not a parent, this is always false. */
  readonly hasMatchInSubtree: boolean;

  /** How many direct child nodes do NOT have a match in their subtree? (This is
   * useful for showing a "+ N filtered" number to users to indicate how many
   * items are hidden in the UI.) */
  readonly nonMatchingCount: number;
}

/** A Tree whose nodes have been filtered by a predicate function. */
export class TreeFilter<P extends object, N extends object> {
  readonly tree: Tree<P, N>;

  /** The predicate function used to determine whether a node `isMatching` or
   * not.  Updating this ref will update the `.isMatching` property on every
   * node. */
  readonly predicate: Ref<(node: P | N) => boolean>;

  private readonly nodes = new WeakMap<P | N, FilterInfo>();

  constructor(tree: Tree<P, N>, predicate: Ref<(node: P | N) => boolean>) {
    this.tree = tree;
    this.predicate = predicate;
  }

  /** Returns a FilterInfo object describing whether this node (and/or its
   * sub-tree) matches the predicate or not. */
  info(node: P | N): FilterInfo {
    const n = this.nodes.get(node);
    if (n) return n;

    const isParent = this.tree.isParent(node);

    const isMatching = computed(() => this.predicate.value(node));

    const hasMatchInSubtree = isParent
      ? computed(() => {
          for (const c of this.tree.childrenOf(node)) {
            if (!c) continue;
            const i = this.info(c);
            if (i.isMatching || i.hasMatchInSubtree) return true;
          }
          return false;
        })
      : computed(() => false);

    const nonMatchingCount = isParent
      ? computed(() => {
          let count = 0;
          for (const c of this.tree.childrenOf(node)) {
            if (!c) continue;
            const i = this.info(c);
            if (!i.isMatching && !i.hasMatchInSubtree) ++count;
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
