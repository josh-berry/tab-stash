/** The position of a child node within the tree. */
export interface TreePosition<P extends object> {
  parent: P;
  index: number;
}

/** A bunch of methods for manipulating intrusive tree data structures.  Extend
 * this class to provide your own basic accessor/mutator methods, and you will
 * get various algorithms for working with your specific tree.
 *
 * There are three type parameters you must provide:
 *
 * - `R` nodes can only be root nodes. They may have children but no parents.
 * - `M` nodes can have both parents and children; they can be anywhere in the
 *   tree (including roots and leaves).
 * - `L` nodes can only be leaf nodes. They may have parents but no children.
 *
 * There is no need to overlap types; for example, if your tree only has one
 * type of node, you can just use `<never, Node, never>`. Or if your tree does
 * not have a special root type, you can use `<never, Parent, Leaf>`.
 */
export abstract class Tree<
  R extends object,
  M extends object,
  L extends object,
> {
  /** Can this node contain other nodes? */
  abstract isRootType(node: R | M | L): node is R;

  /** Can this node be contained by another node? */
  abstract isLeafType(node: R | M | L): node is L;

  /** Have all the children for this parent been loaded into memory? */
  abstract isLoaded(parent: R | M): boolean;

  /** What is the position of this node in its parent (if it has one)?  (Note
   * that the returned position object may be mutated directly by the caller if
   * the node is being moved.  Don't rely on setPosition() to inform you of
   * every move.) */
  abstract positionOf(node: M | L): TreePosition<R | M> | undefined;

  /** Return a reference to the array of child nodes inside this parent.  (Note
   * that the array may be mutated directly by the caller if children within the
   * node are being inserted, removed, or moved.) */
  abstract childrenOf(parent: R | M): (M | L | undefined)[];

  /** If the parent is fully-loaded, return all children. Otherwise, return
   * undefined. */
  allChildrenOf(parent: R | M): readonly (M | L)[] | undefined {
    if (!this.isLoaded(parent)) return undefined;
    return this.childrenOf(parent) as readonly (M | L)[];
  }

  /** Cause positionOf() for this node to return the specified `position`
   * object.  Should NOT update the parent's children in any way; this is
   * handled by the caller. */
  protected abstract setPosition(
    node: M | L,
    position: TreePosition<R | M> | undefined,
  ): void;

  /** Walks all the nodes from `node` up to the root node, yielding each node in
   * turn (including `node` itself). */
  *nodesOnPathToRoot(node: R | M | L): Generator<R | M | L> {
    let item: R | M | L | undefined = node;
    while (item) {
      yield item;
      if (this.isRootType(item)) break;
      item = this.positionOf(item)?.parent;
    }
  }

  /** Walks all the nodes from `node` up to the root node, yielding each node's
   * position in turn. */
  *positionsOnPathToRoot(node: R | M | L): Generator<TreePosition<R | M>> {
    let item: R | M | L | undefined = node;
    while (true) {
      if (this.isRootType(item)) break;
      const pos = this.positionOf(item);
      if (!pos) break;
      yield pos;
      item = pos.parent;
    }
  }

  /** Check if `node` is a child of `parent`. Children are considered to contain
   * themselves, so if `node === parent`, this returns true. */
  isChildInParent(node: R | M | L, parent: R | M): boolean {
    for (const n of this.nodesOnPathToRoot(node)) {
      if (n === parent) return true;
    }
    return false;
  }

  /** Return the path from a root to this node, as a list of Position objects
   * starting from the root and ending at the node's parent.
   *
   * This means that if the node itself is a root (i.e. it has no parents), the
   * returned path will be the empty array. */
  pathTo(node: R | M | L): TreePosition<R | M>[] {
    const path = Array.from(this.positionsOnPathToRoot(node));
    path.reverse();
    return path;
  }

  /** Places a node in the tree exactly at the specified position. Does not
   * shift any other nodes to make room. If a node already exists at this
   * location, throws.
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
  placeNode(node: M | L, newPosition: TreePosition<R | M>) {
    const newChildren = this.childrenOf(newPosition.parent);

    if (this.positionOf(node)) {
      throw new Error(`Can't add node that's already in a tree`);
    }

    if (newPosition.index < 0) {
      throw new Error(`Index ${newPosition.index} out of bounds`);
    }

    if (
      newPosition.index > newChildren.length &&
      this.isLoaded(newPosition.parent)
    ) {
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
    this.setPosition(node, newPosition);
  }

  /** Inserts a node into the tree at the specified position, shifting other
   * nodes to the right to make room for the new node.
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
  insertNode(node: M | L | undefined, newPosition: TreePosition<R | M>) {
    const newChildren = this.childrenOf(newPosition.parent);

    if (node && this.positionOf(node)) {
      throw new Error(`Can't add node that's already in a tree`);
    }

    if (newPosition.index < 0) {
      throw new Error(`Index ${newPosition.index} out of bounds`);
    }

    if (newPosition.index > newChildren.length) {
      if (this.isLoaded(newPosition.parent)) {
        throw new Error(
          `Index ${newPosition.index} is past the end of a fully-loaded parent`,
        );
      }

      // The new parent is only partially-loaded; extend it to make room for the
      // child we're about to insert.
      while (newPosition.index > newChildren.length)
        newChildren.push(undefined);
    }

    newChildren.splice(newPosition.index, 0, node);
    for (let i = newPosition.index + 1; i < newChildren.length; ++i) {
      const nc = newChildren[i];
      // Updating the position in-place avoids creating a lot of garbage.
      if (nc) this.positionOf(nc)!.index = i;
    }

    if (node) this.setPosition(node, newPosition);
  }

  /** Removes the node at the specified position from its parent, re-shuffling
   * children in the parent to close the gap. The removed node's `.position` will
   * then be `undefined`.
   *
   * This takes a position instead of a node, because it must be possible to
   * remove nodes from the tree that are not loaded. */
  removeNode(position: TreePosition<R | M>) {
    const oldChildren = this.childrenOf(position.parent);
    const node = oldChildren[position.index];

    oldChildren.splice(position.index, 1);
    for (let i = position.index; i < oldChildren.length; ++i) {
      const oc = oldChildren[i];
      // Updating the position in-place avoids creating a lot of garbage.
      if (oc) this.positionOf(oc)!.index = i;
    }

    if (node) this.setPosition(node, undefined);
  }

  /** Calls a function for each node in a subtree, starting from the root.
   * Traversal is done pre-order, depth-first. Nodes which are not loaded are
   * skipped, since we have no way to load them. */
  forEachNodeInSubtree(subtree: R | M | L, f: (node: R | M | L) => void) {
    f(subtree);
    if (this.isLeafType(subtree)) return;
    for (const c of this.childrenOf(subtree)) {
      if (c) this.forEachNodeInSubtree(c, f);
    }
  }

  /** Given `parent` and an `index`, move all the children of `parent` starting
   * from `index` into `newEmptyParent`, and insert `newEmptyParent` into
   * `parent`'s parent right after `parent`'s current index.
   */
  splitParentAtIndexIntoNode(parent: M, index: number, newEmptyParent: M) {
    const parentPos = this.positionOf(parent);
    if (!parentPos) {
      throw new Error(`Can't split a parent that's not in the tree`);
    }

    if (this.positionOf(newEmptyParent)) {
      throw new Error(`Can't add a new empty node that's already in a tree`);
    }

    const parentChildren = this.childrenOf(parent);
    const newChildren = this.childrenOf(newEmptyParent);
    if (newChildren.length > 0) {
      throw new Error(`Can't split a parent into a non-empty node`);
    }

    for (
      let removePoint = index, insertPoint = 0;
      removePoint < parentChildren.length;
      ++removePoint, ++insertPoint
    ) {
      const c = parentChildren[removePoint];
      if (c) {
        this.setPosition(c, {parent: newEmptyParent, index: insertPoint});
      }
      newChildren.push(c);
    }
    parentChildren.length = index;

    this.insertNode(newEmptyParent, {
      parent: parentPos.parent,
      index: parentPos.index + 1,
    });
  }

  /** Given two nodes, merge `right` into `left` and remove `right` from its
   * position in its own parent. */
  mergeIntoLeftFromRight(left: M, right: M) {
    const leftChildren = this.childrenOf(left);
    const rightChildren = this.childrenOf(right);
    for (let i = 0; i < rightChildren.length; ++i) {
      const c = rightChildren[i];
      if (c) {
        this.setPosition(c, {parent: left, index: leftChildren.length});
      }
      leftChildren.push(c);
    }
    rightChildren.length = 0;

    const rightPos = this.positionOf(right);
    if (rightPos) this.removeNode(rightPos);
  }
}
