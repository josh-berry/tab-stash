export interface Tree<P extends object, C extends object> {
  /** Is this node a parent node (i.e. a node which may contain other nodes)? */
  isParent(node: P | C): node is P;

  /** Return the parent that contains this node, as well as the index of the
   * node in the parent's list of children. If the child has no parent (i.e. it
   * is a root), returns `undefined`. */
  positionOf(node: P | C): Position<P> | undefined;

  /** Return a list of child nodes directly beneath this parent. */
  childrenOf(parent: P): (P | C)[];
}

/** A position within a parent node's list of children. */
export type Position<P extends object> = {parent: P; index: number};

/** Return the path from a root to this node, as a list of Position objects
 * starting from the root and ending at the node's parent. */
export function pathTo<P extends object, C extends object>(
  tree: Tree<P, C>,
  node: P | C,
): Position<P>[] {
  const path: Position<P>[] = [];
  while (true) {
    const pos = tree.positionOf(node);
    if (!pos) break;
    path.push(pos);
    node = pos.parent;
  }
  path.reverse();
  return path;
}
