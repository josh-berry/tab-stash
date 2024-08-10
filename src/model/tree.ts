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
  isLoaded: boolean;
  readonly children: (P | N | undefined)[];
}

export type LoadedTreeParent<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
> = Omit<P, "isLoaded" | "children"> & {
  isLoaded: true;
  readonly children: (P | N)[];
};

/** The position of a child node within the tree. */
export interface TreePosition<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
> {
  parent: P;
  index: number;
}

/** The type of a function that checks if the node is a TreeParent or not. */
export type IsParentFn<P extends TreeParent<P, N>, N extends TreeNode<P, N>> = (
  node: P | N,
) => node is P;

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

/** Places a node in the tree exactly at the specified position. Does not shift
 * any other nodes to make room. If a node already exists at this location,
 * throws.
 *
 * If the new index is past the end of the list of children in the parent, one
 * of two things will happen:
 *
 * - If the parent is fully-loaded, we will throw.  This is to prevent callers
 *   from unintentionally creating gaps in the parent's list of children after
 *   the parent has been fully-loaded.
 * - Otherwise, we will extend the list by inserting `undefined`s, on the
 *   assumption the other nodes in the list will be filled in later.
 */
export function placeNode<P extends TreeParent<P, N>, N extends TreeNode<P, N>>(
  node: N,
  newPosition: TreePosition<P, N>,
) {
  const newChildren = newPosition.parent.children;

  if (node.position) throw new Error(`Can't add node that's already in a tree`);

  if (newPosition.index < 0) {
    throw new Error(`Index ${newPosition.index} out of bounds`);
  }

  if (newPosition.index > newChildren.length && newPosition.parent.isLoaded) {
    throw new Error(
      `Index ${newPosition.index} is past the end of a fully-loaded parent`,
    );
  }

  if (newChildren[newPosition.index] !== undefined) {
    throw new Error(`Node already exists at index ${newPosition.index}`);
  }

  // The new parent is only partially-loaded; extend it to make room for the
  // child we're about to insert.
  while (newPosition.index >= newChildren.length) newChildren.push(undefined);

  newChildren[newPosition.index] = node;
  node.position = newPosition;
}

/** Inserts a node into the tree at the specified position, shifting other nodes
 * to the right to make room for the new node.
 *
 * If the new index is past the end of the list of children in the parent, one
 * of two things will happen:
 *
 * - If the parent is fully-loaded, we will throw.  This is to prevent callers
 *   from unintentionally creating gaps in the parent's list of children after
 *   the parent has been fully-loaded.
 * - Otherwise, we will extend the list by inserting `undefined`s, on the
 *   assumption the other nodes in the list will be filled in later.
 */
export function insertNode<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
>(node: N | undefined, newPosition: TreePosition<P, N>) {
  const newChildren = newPosition.parent.children;

  if (node && node.position) {
    throw new Error(`Can't add node that's already in a tree`);
  }

  if (newPosition.index < 0) {
    throw new Error(`Index ${newPosition.index} out of bounds`);
  }

  if (newPosition.index > newChildren.length) {
    if (newPosition.parent.isLoaded) {
      throw new Error(
        `Index ${newPosition.index} is past the end of a fully-loaded parent`,
      );
    }

    // The new parent is only partially-loaded; extend it to make room for the
    // child we're about to insert.
    while (newPosition.index > newChildren.length) newChildren.push(undefined);
  }

  newChildren.splice(newPosition.index, 0, node);
  for (let i = newPosition.index + 1; i < newChildren.length; ++i) {
    const nc = newChildren[i];
    if (nc) nc.position!.index = i;
  }

  if (node) node.position = newPosition;
}

/** Removes the node at the specified position from its parent, re-shuffling
 * children in the parent to close the gap. The removed node's `.position` will
 * then be `undefined`.
 *
 * This takes a position instead of a node, because it must be possible to
 * remove nodes from the tree that are not loaded. */
export function removeNode<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
>(position: TreePosition<P, N>) {
  const node = position.parent.children[position.index];
  const oldChildren = position.parent.children;

  oldChildren.splice(position.index, 1);
  for (let i = position.index; i < oldChildren.length; ++i) {
    const oc = oldChildren[i];
    if (oc) oc.position!.index = i;
  }

  if (node) node.position = undefined;
}

/** Calls a function for each node in a subtree, starting from the root.
 * Traversal is done pre-order, depth-first. Nodes which are not loaded are
 * skipped, since we have no way to load them. */
export function forEachNodeInSubtree<
  P extends TreeParent<P, N>,
  N extends TreeNode<P, N>,
>(subtree: P | N, isParent: IsParentFn<P, N>, f: (node: P | N) => void) {
  f(subtree);
  if (!isParent(subtree)) return;
  for (const c of subtree.children) if (c) forEachNodeInSubtree(c, isParent, f);
}
