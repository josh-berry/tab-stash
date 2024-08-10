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
    fixup_child_ordering(this.root);
  }

  /* c8 ignore next 3 -- not implemented */
  async get(idOrIdList: string | string[]): Promise<BM.BookmarkTreeNode[]> {
    if (idOrIdList instanceof Array) {
      return idOrIdList.map(id => node_only(this._get(id)));
    }
    return [node_only(this._get(idOrIdList))];
  }

  async getChildren(id: string): Promise<BM.BookmarkTreeNode[]> {
    // Firefox has this undocumented behavior; need to confirm on Chrome
    if (id === "") return this.root.children.map(n => node_only(n));
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

    const parentId = bookmark.parentId ?? this.root.id;
    const parent = this._getFolder(parentId);

    const index = bookmark.index ?? parent.children.length;
    /* c8 ignore next 5 -- bug-checking */
    if (index < 0 || index > parent.children.length) {
      console.error("Bookmark tree:", this.root);
      console.error("create() called with:", bookmark);
      throw new Error(`Invalid index specified: ${index}`);
    }

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
        index,
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
        index,
        dateAdded: Date.now(),
      };
    } else {
      bm = {
        id: this._freeID(),
        /* c8 ignore next -- for `?? ''` */
        title: bookmark.title ?? "",
        children: [],
        parentId,
        index,
        dateAdded: Date.now(),
      };
      if (Math.random() < 0.5) bm.type = "folder";
    }

    this.by_id.set(bm.id, bm);
    parent.children.splice(index, 0, bm);
    fixup_child_ordering(parent);

    this.onCreated.send(bm.id, node_only(bm));
    return node_only(bm);
  }

  async move(
    id: string,
    destination: BM.MoveDestinationType,
  ): Promise<BM.BookmarkTreeNode> {
    const node = this._get(id);
    const oldParent = this._getFolder(node.parentId!);
    /* c8 ignore next -- tests always pass parentId */
    const newParent = this._getFolder(destination.parentId ?? node.parentId!);
    const oldIndex = node.index;
    const newIndex = destination.index ?? newParent.children.length;

    // Chrome has add-then-remove behavior, while Firefox has
    // remove-then-add behavior.  We have to pick one consistently (so
    // bookmarks land in predictable places), so we just go with Firefox's
    // behavior.
    oldParent.children.splice(oldIndex, 1);
    newParent.children.splice(newIndex, 0, node);

    fixup_child_ordering(oldParent);
    if (oldParent !== newParent) fixup_child_ordering(newParent);

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

    const parent = this._getFolder(node.parentId!);
    parent.children.splice(node.index, 1);
    fixup_child_ordering(parent);
    this.by_id.delete(id);

    this.onRemoved.send(id, {
      parentId: node.parentId!,
      index: node.index,
      node: node_only(node),
    });
  }

  async removeTree(id: string): Promise<void> {
    const node = this._getFolder(id);

    const parent = this._getFolder(node.parentId!);
    parent.children.splice(node.index, 1);
    fixup_child_ordering(parent);
    this.by_id.delete(id);

    this.onRemoved.send(id, {
      parentId: node.parentId!,
      index: node.index,
      node: node_only(node),
    });
  }

  private _getFolder(id: string): Folder {
    const node = this._get(id);
    /* c8 ignore next -- bug-checking */
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

function fixup_child_ordering(parent: Folder) {
  parent.children.forEach((c, i) => {
    c.parentId = parent.id;
    c.index = i;
  });
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
