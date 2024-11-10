import type {Bookmarks as BM} from "webextension-polyfill";

import {makeRandomString} from "../../util/random.js";
import * as events from "../events.js";

type Node = Folder | Bookmark | Separator;
type Folder = NodeInfo & {type?: "folder"; children: Node[]};
type Separator = NodeInfo & {type?: "separator"; url: string};
type Bookmark = NodeInfo & {type?: "bookmark"; url: string};
type NodeInfo = {
  id: string;
  title: string;
  dateAdded: number;
  parentId: string | undefined;
  index: number;
};

class MockBookmarks implements BM.Static {
  readonly onCreated: events.MockEvent<
    (id: string, bookmark: BM.BookmarkTreeNode) => void
  > = new events.MockEvent("browser.bookmarks.onCreated");
  readonly onRemoved: events.MockEvent<
    (id: string, removeInfo: BM.OnRemovedRemoveInfoType) => void
  > = new events.MockEvent("browser.bookmarks.onRemoved");
  readonly onChanged: events.MockEvent<
    (id: string, changeInfo: BM.OnChangedChangeInfoType) => void
  > = new events.MockEvent("browser.bookmarks.onChanged");
  readonly onMoved: events.MockEvent<
    (id: string, moveInfo: BM.OnMovedMoveInfoType) => void
  > = new events.MockEvent("browser.bookmarks.onMoved");

  private readonly root: Folder;
  private readonly by_id = new Map<string, Node>();

  private readonly new_bm_parent: Folder;

  constructor() {
    this.root = {
      id: this._freeID(),
      title: "",
      parentId: undefined,
      index: 0,
      children: [],
      dateAdded: 0,
    };
    this.by_id.set(this.root.id, this.root);

    // Yes, these names are deliberately obtuse, to prevent application code
    // from trying to guess at the bookmark structure. :)
    this.root.children.push({
      id: this._freeID(),
      index: 0,
      parentId: this.root.id,
      title: "Toolbin",
      children: [],
      dateAdded: 0,
    });
    this.root.children.push({
      id: this._freeID(),
      index: 1,
      parentId: this.root.id,
      title: "Menu Can",
      children: [],
      dateAdded: 0,
    });
    this.root.children.push({
      id: this._freeID(),
      index: 2,
      parentId: this.root.id,
      title: "Compost Box",
      children: [],
      dateAdded: 0,
    });
    for (const c of this.root.children) this.by_id.set(c.id, c);

    this.new_bm_parent = this.root.children[
      Math.floor(Math.random() * 3)
    ] as Folder;

    /* c8 ignore next -- bug-checking */
    if (!this.new_bm_parent) throw new Error(`bm startup: no new_bm_parent`);
  }

  async get(idOrIdList: string | string[]): Promise<BM.BookmarkTreeNode[]> {
    if (idOrIdList instanceof Array) {
      return idOrIdList.map(id => node_only(this._get(id)));
    }
    return [node_only(this._get(idOrIdList))];
  }

  async getChildren(id: string): Promise<BM.BookmarkTreeNode[]> {
    return this._getFolder(id).children.map(node => node_only(node));
  }

  /* c8 ignore next 3 -- not implemented*/
  async getRecent(numberOfItems: number): Promise<BM.BookmarkTreeNode[]> {
    throw new Error("Method not implemented.");
  }

  async getTree(): Promise<BM.BookmarkTreeNode[]> {
    return [JSON.parse(JSON.stringify(this.root))];
  }

  async getSubTree(id: string): Promise<BM.BookmarkTreeNode[]> {
    return [JSON.parse(JSON.stringify(this._getFolder(id)))];
  }

  async search(
    query: string | BM.SearchQueryC2Type,
  ): Promise<BM.BookmarkTreeNode[]> {
    /* c8 ignore next -- not implemented */
    if (typeof query !== "string") throw new Error("Method not implemented.");

    const matching: BM.BookmarkTreeNode[] = [];

    const visit = (bm: Node) => {
      if (bm.title === query) matching.push(node_only(bm));
      if ("children" in bm) for (const c of bm.children) visit(c);
    };

    visit(this.root);

    return matching;
  }

  async create(bookmark: BM.CreateDetails): Promise<BM.BookmarkTreeNode> {
    /* c8 ignore next 3 -- bug-checking */
    if (bookmark.type && bookmark.type !== "separator") {
      throw new Error(`Bookmark type is not supported on Chrome`);
    }

    const parentId = bookmark.parentId ?? this.new_bm_parent.id;
    const parent = this._getFolder(parentId);

    const index = bookmark.index ?? parent.children.length;
    /* c8 ignore next 5 -- bug-checking */

    // Allow for the creation of "corrupt" bookmarks folders by specifying
    // invalid indexes. We still want the bookmarks to be positioned properly in
    // the array, but we want the .index property to be intentionally wrong.
    const recordedIndex = (bookmark as any)._index ?? index;

    let bm: Node;
    if (bookmark.url !== undefined) {
      /* c8 ignore next 3 -- bug-checking */
      if (bookmark.type === "separator") {
        throw new Error(`Can't create separator with a URL`);
      }
      bm = {
        id: this._freeID(),
        /* c8 ignore next -- for `?? ''` */
        title: bookmark.title ?? "",
        url: bookmark.url,
        parentId,
        index: recordedIndex,
        dateAdded: Date.now(),
      };
      if (Math.random() < 0.5) bm.type = "bookmark";
    } else if (bookmark.type === "separator") {
      /* c8 ignore next 3 -- bug-checking */
      if (bookmark.title) {
        throw new Error(`Can't create separator with a title`);
      }
      bm = {
        id: this._freeID(),
        title: "",
        url: "",
        type: "separator",
        parentId,
        index: recordedIndex,
        dateAdded: Date.now(),
      };
    } else {
      bm = {
        id: this._freeID(),
        /* c8 ignore next -- for `?? ''` */
        title: bookmark.title ?? "",
        children: [],
        parentId,
        index: recordedIndex,
        dateAdded: Date.now(),
      };
      if (Math.random() < 0.5) bm.type = "folder";
    }

    this.by_id.set(bm.id, bm);

    // NOTE: The way we splice bookmarks into (and out of) the parent node is
    // very deliberate and intended to mimic Firefox's implementation for doing
    // the same.  This is so the mock has consistent/bug-for-bug compatibility
    // with how Firefox behaves when there are inconsistent indexes in the
    // bookmarks DB.
    parent.children.splice(index, 0, bm);
    for (let i = index + 1; i < parent.children.length; ++i) {
      parent.children[i].index++;
    }

    this.onCreated.send(bm.id, node_only(bm));
    return node_only(bm);
  }

  async move(
    id: string,
    destination: BM.MoveDestinationType,
  ): Promise<BM.BookmarkTreeNode> {
    if (destination.index !== undefined && destination.index < 0) {
      throw new Error(`Index ${destination.index} is too small`);
    }

    const node = this._get(id);
    const oldParent = this._getFolder(node.parentId!);
    /* c8 ignore next -- tests always pass parentId */
    const newParent = this._getFolder(destination.parentId ?? node.parentId!);

    // We search for oldIndex this way since the bookmarks DB might be "corrupt"
    // (i.e. node.index is unreliable), yet we still want move() to find and
    // move the correct node in oldParent.children.  In real Firefox, this makes
    // sense, because bookmarks are always looked up by ID and their index and
    // parentId are stored directly in the places DB, so even a corrupt Firefox
    // DB will behave similarly to this.
    const oldIndex = oldParent.children.findIndex(n => n === node);
    let newIndex = destination.index ?? newParent.children.length;
    newIndex = Math.min(newIndex, newParent.children.length);

    // Chrome has add-then-remove behavior, while Firefox has
    // remove-then-add behavior.  We have to pick one consistently (so
    // bookmarks land in predictable places), so we just go with Firefox's
    // behavior.
    //
    // NOTE: The way we splice bookmarks into (and out of) the parent node is
    // very deliberate and intended to mimic Firefox's implementation for doing
    // the same.  This is so the mock has consistent/bug-for-bug compatibility
    // with how Firefox behaves when there are inconsistent indexes in the
    // bookmarks DB.

    oldParent.children.splice(oldIndex, 1);
    for (let i = oldIndex; i < oldParent.children.length; ++i) {
      oldParent.children[i].index--;
    }

    newParent.children.splice(newIndex, 0, node);
    node.parentId = newParent.id;
    node.index = newIndex;
    for (let i = newIndex + 1; i < newParent.children.length; ++i) {
      newParent.children[i].index++;
    }

    this.onMoved.send(id, {
      oldParentId: oldParent.id,
      oldIndex,
      parentId: node.parentId!,
      index: node.index,
    });

    return node_only(node);
  }

  async update(
    id: string,
    changes: BM.UpdateChangesType,
  ): Promise<BM.BookmarkTreeNode> {
    const node = this._get(id);

    if (changes.url !== undefined) {
      /* c8 ignore next -- bug-checking */
      if ("children" in node) throw new Error(`Cannot update a folder's URL`);
      node.url = changes.url;
    }
    /* c8 ignore next -- tests always update the title */
    if (changes.title !== undefined) node.title = changes.title;

    const ev: BM.OnChangedChangeInfoType = {title: node.title};
    if ("url" in node) ev.url = node.url;
    this.onChanged.send(id, ev);

    return node_only(node);
  }

  async remove(id: string): Promise<void> {
    const node = this._get(id);
    /* c8 ignore next 3 -- bug-checking */
    if ("children" in node && node.children.length > 0) {
      throw new Error(`Cannot delete a non-empty folder with remove()`);
    }

    // NOTE: The way we splice bookmarks into (and out of) the parent node is
    // very deliberate and intended to mimic Firefox's implementation for doing
    // the same.  This is so the mock has consistent/bug-for-bug compatibility
    // with how Firefox behaves when there are inconsistent indexes in the
    // bookmarks DB.
    const parent = this._getFolder(node.parentId!);
    parent.children.splice(node.index, 1);
    for (let i = node.index; i < parent.children.length; ++i) {
      parent.children[i].index--;
    }

    this.by_id.delete(id);

    this.onRemoved.send(id, {
      parentId: node.parentId!,
      index: node.index,
      node: node_only(node),
    });
  }

  async removeTree(id: string): Promise<void> {
    const node = this._getFolder(id);

    // NOTE: The way we splice bookmarks into (and out of) the parent node is
    // very deliberate and intended to mimic Firefox's implementation for doing
    // the same.  This is so the mock has consistent/bug-for-bug compatibility
    // with how Firefox behaves when there are inconsistent indexes in the
    // bookmarks DB.
    const parent = this._getFolder(node.parentId!);
    parent.children.splice(node.index, 1);
    for (let i = node.index; i < parent.children.length; ++i) {
      parent.children[i].index--;
    }

    this.by_id.delete(id);

    this.onRemoved.send(id, {
      parentId: node.parentId!,
      index: node.index,
      node: node_only(node),
    });
  }

  private _getFolder(id: string): Folder {
    const node = this._get(id);
    /* c8 ignore next 3 -- bug-checking */
    if (!("children" in node)) {
      throw new Error(`${id} is not a folder`);
    }
    return node;
  }

  private _get(id: string): Node {
    const node = this.by_id.get(id);
    /* c8 ignore next -- bug-checking */
    if (!node) {
      throw new Error(`No such bookmark: ${id}`);
    }
    return node;
  }

  private _freeID(): string {
    let id = makeRandomString(8);
    /* c8 ignore next -- random strings rarely collide */
    while (this.by_id.has(id)) id = makeRandomString(8);
    return id;
  }
}

function node_only(node: Node): BM.BookmarkTreeNode {
  const res: BM.BookmarkTreeNode = {...node};
  delete res.children;
  return JSON.parse(JSON.stringify(res));
}

export default (() => {
  const exports = {
    bookmarks: new MockBookmarks(),

    reset() {
      exports.bookmarks = new MockBookmarks();
      (<any>globalThis).browser.bookmarks = exports.bookmarks;
    },
  };

  exports.reset();

  return exports;
})();
