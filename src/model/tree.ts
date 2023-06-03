/** A tree node which can be contained by a TreeParent. Nodes which can be both
 * parents and children should implement TreeParent. */
export interface TreeNode<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
> {
  position: TreePosition<P, N> | undefined;
}

/** A tree node which can contain other nodes. */
export interface TreeParent<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
> extends TreeNode<P, N> {
  readonly children: (P | N)[];
}

/** The position of a child node within the tree. */
export interface TreePosition<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
> {
  parent: P;
  index: number;
}

/** Check if `child` is contained, directly or indirectly, by `parent`. Children
 * are considered to contain themselves, so if `child === parent`, this returns
 * true. */
export function isChildInParent<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
>(node: N, parent: P): boolean {
  let item: P | N | undefined = node;
  while (item) {
    if (item === parent) return true;
    item = item.position?.parent;
  }
  return false;
}

/** Return the path from a root to this node, as a list of Position objects
 * starting from the root and ending at the node's parent.
 *
 * This means that if the node is itself a root (i.e. it has no parents), the
 * returned path will be the empty array.*/
export function pathTo<P extends TreeParent<P, N>, N extends TreeNode<P, N>>(
  node: P | N,
): TreePosition<P, N>[] {
  const path: TreePosition<P, N>[] = [];
  while (true) {
    const pos = node.position;
    if (!pos) break;
    path.push(pos);
    node = pos.parent;
  }
  path.reverse();
  return path;
}

/** Moves a child to the specified position in the tree, removing it from its
 * prior parent if necessary. If _newPosition_ is `undefined` or omitted, the
 * child is removed from the tree.
 *
 * **WARNING:** This method **does not** check that the child is not its own
 * parent, so it is possible to create cycles accidentally.  It is assumed that
 * the caller will perform this check (e.g. using `isChildInParent()`).
 *
 * When re-ordering a child within the same parent, the movement happens as if
 * the child is first removed from its old location and then added to its new
 * location--that is, after the re-ordering is complete, `newPosition.index`
 * will be the new index of the child.
 *
 * For convenience, `newPosition.index` will be clamped to
 * `newPosition.children.length`, so it is possible to pass an arbitrarily large
 * index to indicate that you want the child to be appended to the parent's
 * children.
 *
 * Right now, the `newPosition` object is used (and modified in-place, if
 * necessary) directly as the child's new `.position`. This means that
 * `newPosition` must not be modified after it is passed to `setPosition()`, or
 * tree inconsistencies will result. This is an implementation detail that may
 * change in the future. */
export function setPosition<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
>(child: N, newPosition: TreePosition<P, N> | undefined) {
  const oldPosition = child.position;
  if (oldPosition) {
    const oldChildren = oldPosition.parent.children;
    oldChildren.splice(oldPosition.index, 1);
    for (let i = oldPosition.index; i < oldChildren.length; ++i) {
      oldChildren[i].position!.index = i;
    }

    child.position = undefined;
  }

  if (newPosition) {
    const newChildren = newPosition.parent.children;
    if (newPosition.index > newChildren.length) {
      newPosition.index = newChildren.length;
    }

    newChildren.splice(newPosition.index, 0, child);
    for (let i = newPosition.index + 1; i < newChildren.length; ++i) {
      newChildren[i].position!.index = i;
    }

    child.position = newPosition;
  }
}
