/** The position of a child node within the tree. */
export interface TreePosition<P extends object> {
  parent: P;
  index: number;
}

/** A bunch of methods for manipulating intrusive tree data structures.  Extend
 * this class to provide your own basic accessor/mutator methods, and you will
 * get various algorithms for working with your specific tree. */
export abstract class Tree<P extends object, N extends object> {
  /** Is this node a `P`; that is, can it contain other nodes? */
  abstract isParent(node: P | N): node is P;

  /** Have all the children for this parent been loaded into memory? */
  abstract isLoaded(parent: P): boolean;

  /** What is the position of this node in its parent (if it has one)?  (Note
   * that the returned position object may be mutated directly by the caller if
   * the node is being moved.  Don't rely on setPosition() to inform you of
   * every move.) */
  abstract positionOf(node: P | N): TreePosition<P> | undefined;

  /** Return a reference to the array of child nodes inside this parent.  (Note
   * that the array may be mutated directly by the caller if children within the
   * node are being inserted, removed, or moved.) */
  abstract childrenOf(parent: P): (P | N | undefined)[];

  /** If the parent is fully-loaded, return all children. Otherwise, return
   * undefined. */
  allChildrenOf(parent: P): readonly (P | N)[] | undefined {
    if (!this.isLoaded(parent)) return undefined;
    return this.childrenOf(parent) as readonly (P | N)[];
  }

  /** Cause positionOf() for this node to return the specified `position`
   * object.  Should NOT update the parent's children in any way; this is
   * handled by the caller. */
  protected abstract setPosition(
    node: P | N,
    position: TreePosition<P> | undefined,
  ): void;

  /** Check if `node` is a child of `parent`. Children are considered to contain
   * themselves, so if `node === parent`, this returns true. */
  isChildInParent(node: P | N, parent: P): boolean {
    let item: P | N | undefined = node;
    while (item) {
      if (item === parent) return true;
      item = this.positionOf(item)?.parent;
    }
    return false;
  }

  /** Return the path from a root to this node, as a list of Position objects
   * starting from the root and ending at the node's parent.
   *
   * This means that if the node itself is a root (i.e. it has no parents), the
   * returned path will be the empty array. */
  pathTo(node: P | N): TreePosition<P>[] {
    const path: TreePosition<P>[] = [];
    while (true) {
      const pos = this.positionOf(node);
      if (!pos) break;
      path.push(pos);
      node = pos.parent;
    }
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
  placeNode(node: N, newPosition: TreePosition<P>) {
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
  insertNode(node: N | undefined, newPosition: TreePosition<P>) {
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
  removeNode(position: TreePosition<P>) {
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
  forEachNodeInSubtree(subtree: P | N, f: (node: P | N) => void) {
    f(subtree);
    if (!this.isParent(subtree)) return;
    for (const c of this.childrenOf(subtree)) {
      if (c) this.forEachNodeInSubtree(c, f);
    }
  }
}
