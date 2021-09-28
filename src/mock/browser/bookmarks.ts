import type {Bookmarks as BM} from 'webextension-polyfill';

import * as events from '../events';
import {makeRandomString} from '../../util/random';

type Node = Folder | Bookmark | Separator;
type Folder = NodeInfo & {type?: 'folder', children: Node[]};
type Separator = NodeInfo & {type?: 'separator', url: string};
type Bookmark = NodeInfo & {type?: 'bookmark', url: string};
type NodeInfo = {id: string, title: string, parentId: string | undefined, index: number};

class MockBookmarks implements BM.Static {
    readonly onCreated: events.MockEvent<(id: string, bookmark: BM.BookmarkTreeNode) => void> =
        new events.MockEvent('browser.bookmarks.onCreated');
    readonly onRemoved: events.MockEvent<(id: string, removeInfo: BM.OnRemovedRemoveInfoType) => void> =
        new events.MockEvent('browser.bookmarks.onCreated');
    readonly onChanged: events.MockEvent<(id: string, changeInfo: BM.OnChangedChangeInfoType) => void> =
        new events.MockEvent('browser.bookmarks.onCreated');
    readonly onMoved: events.MockEvent<(id: string, moveInfo: BM.OnMovedMoveInfoType) => void> =
        new events.MockEvent('browser.bookmarks.onCreated');

    private readonly root: Folder;
    private readonly by_id = new Map<string, Node>();

    constructor() {
        this.root = {
            id: this._freeID(), title: '', parentId: undefined, index: 0,
            children: []
        };
        this.by_id.set(this.root.id, this.root);
        fixup_child_ordering(this.root);
    }

    async get(idOrIdList: string | string[]): Promise<BM.BookmarkTreeNode[]> {
        if (idOrIdList instanceof Array) {
            return idOrIdList.map(id => node_only(this._get(id)));
        }
        return [node_only(this._get(idOrIdList))];
    }

    async getChildren(id: string): Promise<BM.BookmarkTreeNode[]> {
        const folder = this._getFolder(id);
        return JSON.parse(JSON.stringify(folder.children));
    }

    async getRecent(numberOfItems: number): Promise<BM.BookmarkTreeNode[]> {
        throw new Error('Method not implemented.');
    }

    async getTree(): Promise<BM.BookmarkTreeNode[]> {
        return [JSON.parse(JSON.stringify(this.root))];
    }

    async getSubTree(id: string): Promise<BM.BookmarkTreeNode[]> {
        const bm = this.by_id.get(id);
        if (! bm) throw new Error(`Invalid bookmark ID: ${id}`);
        return [JSON.parse(JSON.stringify(bm))];
    }

    async search(query: string | BM.SearchQueryC2Type): Promise<BM.BookmarkTreeNode[]> {
        throw new Error('Method not implemented.');
    }

    async create(bookmark: BM.CreateDetails): Promise<BM.BookmarkTreeNode> {
        if (bookmark.type && bookmark.type !== 'separator') {
            throw new Error(`Bookmark type is not supported on Chrome`);
        }

        const parentId = bookmark.parentId ?? this.root.id;
        const parent = this._getFolder(parentId);

        const index = bookmark.index ?? parent.children.length;
        if (index < 0 || index > parent.children.length) {
            console.error('Bookmark tree:', this.root);
            console.error('create() called with:', bookmark);
            throw new Error(`Invalid index specified: ${index}`);
        }

        const bm: Node = bookmark.url
            ? {id: this._freeID(), title: bookmark.title ?? '', url: bookmark.url,
               parentId, index}
            : {id: this._freeID(), title: bookmark.title ?? '', children: [],
               parentId, index};

        // Just to make sure nobody relies on Chrome vs. Firefox behavior...
        if (Math.random() < 0.5) bm.type = bookmark.url ? 'bookmark' : 'folder';

        if (bookmark.type === 'separator') bm.type = 'separator';

        this.by_id.set(bm.id, bm);
        parent.children.splice(index, 0, bm);
        fixup_child_ordering(parent);

        this.onCreated.send(bm.id, JSON.parse(JSON.stringify(bm)));
        return node_only(bm);
    }

    async move(id: string, destination: BM.MoveDestinationType): Promise<BM.BookmarkTreeNode> {
        const node = this._get(id);
        const oldParent = this._getFolder(node.parentId!);
        const newParent = this._getFolder(destination.parentId ?? node.parentId!);
        const oldIndex = node.index;
        const newIndex = destination.index ?? newParent.children.length;

        // Chrome has add-then-remove behavior, while Firefox has
        // remove-then-add behavior.  We have to pick one consistently (so
        // bookmarks land in predictable places), so we just go with Chrome's
        // behavior.
        newParent.children.splice(newIndex, 0, node);
        oldParent.children.splice(oldIndex, 1);

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

    async update(id: string, changes: BM.UpdateChangesType): Promise<BM.BookmarkTreeNode> {
        const node = this._get(id);

        if (changes.url !== undefined) {
            if ('children' in node) throw new Error(`Cannot update a folder's URL`);
            node.url = changes.url;
        }
        if (changes.title !== undefined) node.title = changes.title;

        const ev: BM.OnChangedChangeInfoType = {title: node.title};
        if ('url' in node) ev.url = node.url;
        this.onChanged.send(id, ev);

        return node_only(node);
    }

    async remove(id: string): Promise<void> {
        const node = this._get(id);
        if ('children' in node) throw new Error(`Cannot delete a folder with remove()`);

        const parent = this._getFolder(node.parentId!);
        parent.children.splice(node.index, 1);
        fixup_child_ordering(parent);

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

        this.onRemoved.send(id, {
            parentId: node.parentId!,
            index: node.index,
            node: node_only(node),
        });
    }

    private _getFolder(id: string): Folder {
        const node = this._get(id);
        if (! ('children' in node)) {
            console.error(`Bookmark tree:`, this.root);
            throw new Error(`${id} is not a folder`);
        }
        return node;
    }

    private _get(id: string): Node {
        const node = this.by_id.get(id);
        if (! node) {
            console.error(`Bookmark tree:`, this.root);
            throw new Error(`No such bookmark: ${id}`);
        }
        return node;
    }

    private _freeID(): string {
        let id = makeRandomString(8);
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
        }
    };

    exports.reset();

    return exports;
})();
