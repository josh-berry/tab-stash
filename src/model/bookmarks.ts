import {reactive, Ref, ref} from "vue";
import browser, {Bookmarks} from "webextension-polyfill";

import {EventWiring, filterMap, nextTick} from "../util";

/** A node in the bookmark tree. */
export type Node = Bookmark | Separator | Folder;

export type Bookmark = NodeBase & {url: string};
export type Separator = NodeBase & {type: 'separator'};
export type Folder = NodeBase & {children: NodeID[]};

type NodeBase = {
    parentId: NodeID,
    id: NodeID,
    dateAdded?: number,
    title: string,
    $selected?: boolean,
};

export type NodeID = string & {readonly __node_id: unique symbol};

export type NodePosition = {parent: Folder, index: number};

/** The name of the stash root folder.  This name must match exactly (including
 * in capitalization). */
const STASH_ROOT = 'Tab Stash';

const ROOT_FOLDER_HELP = 'https://github.com/josh-berry/tab-stash/wiki/Problems-Locating-the-Tab-Stash-Bookmark-Folder';

/** A Vue model for the state of the browser bookmark tree.
 *
 * Similar to `tabs.ts`, this model follows the WebExtension conventions, with
 * some slight changes to handle hierarchy in the same manner as `tabs.ts`, and
 * ensure the state is JSON-serializable.
 */
export class Model {
    private readonly by_id = new Map<NodeID, Node>();
    private readonly by_url = new Map<string, Set<Bookmark>>();

    /** The root folder for all of the user's bookmarks (Tab Stash or
     * otherwise).  You probably want `stash_root` instead. */
    readonly root: Folder;

    /** The title to look for to locate the stash root. */
    readonly stash_root_name: string;

    /** A Vue ref to the root folder for Tab Stash's saved tabs. */
    readonly stash_root: Ref<Folder | undefined> = ref();

    /** If set, there is more than one candidate stash root, and it's not clear
     * which one to use.  The contents of the warning are an error to show the
     * user and a function to direct them to more information. */
    readonly stash_root_warning: Ref<{text: string, help: () => void} | undefined> = ref();

    /** Tracks folders which are candidates to be the stash root, and their
     * parents (up to the root).  Any changes to these folders should recompute
     * the stash root. */
    private _stash_root_watch = new Set<Folder>();

    //
    // Loading data and wiring up events
    //

    /** Construct a model by loading bookmarks from the browser bookmark store.
     * It will listen for bookmark events to keep itself updated. */
    static async from_browser(stash_root_name_test_only?: string): Promise<Model> {
        const wiring = Model._wiring();
        const tree = await browser.bookmarks.getTree();

        // istanbul ignore if
        if (! stash_root_name_test_only) stash_root_name_test_only = STASH_ROOT;

        const model = new Model(tree[0]!, stash_root_name_test_only);
        wiring.wire(model);
        return model;
    }

    /** Wire up browser events so that we update the state when the browser
     * tells us something has changed.  We use EventWiring to get around the
     * chicken-and-egg problem that we want to start listening for events before
     * the model is fully-constructed yet.  EventWiring will queue events for us
     * until the model is ready, at which point they will all be dispatched. */
    static _wiring(): EventWiring<Model> {
        const wiring = new EventWiring<Model>();
        wiring.listen(browser.bookmarks.onCreated, 'whenBookmarkCreated');
        wiring.listen(browser.bookmarks.onChanged, 'whenBookmarkChanged');
        wiring.listen(browser.bookmarks.onMoved, 'whenBookmarkMoved');
        wiring.listen(browser.bookmarks.onRemoved, 'whenBookmarkRemoved');
        return wiring;
    }

    private constructor(root: Bookmarks.BookmarkTreeNode, stash_root_name: string) {
        this.stash_root_name = stash_root_name;
        this.whenBookmarkCreated(root.id, root); // will set the stash root
        this.root = this.by_id.get(root.id as NodeID)! as Folder;
    }

    //
    // Accessors
    //

    /** Retrieves the node with the specified ID, or throws an exception if it
     * does not exist. */
    node(id: NodeID): Node {
        const node = this.by_id.get(id);
        if (! node) throw new Error(`No such bookmark node: ${id}`);
        return node;
    }

    /** Retrieves the bookmark with the specified ID, or throws an exception if
     * the ID does not exist or is not a bookmark (e.g. it's a separator or
     * folder). */
    bookmark(id: NodeID): Bookmark {
        const node = this.node(id);
        if ('url' in node) return node;
        throw new Error(`Bookmark node is not a bookmark: ${id}`);
    }

    /** Retrieves the folder with the specified ID, or throws an exception if
     * the ID does not exist or is not a folder. */
    folder(id: NodeID): Folder {
        const node = this.node(id);
        if ('children' in node) return node;
        throw new Error(`Bookmark node is not a folder: ${id}`);
    }

    /** Returns a (reactive) set of bookmarks with the specified URL. */
    bookmarksWithURL(url: string): Set<Bookmark> {
        let index = this.by_url.get(url);
        if (! index) {
            index = reactive(new Set<Bookmark>());
            this.by_url.set(url, index);
        }
        return index;
    }

    /** Given a child node, return its parent and the index of the child in the
     * parent's children. */
    positionOf(node: Node): NodePosition {
        const parent = this.folder(node.parentId);
        const index = parent.children.findIndex(id => id === node.id);

        // istanbul ignore if -- internal sanity
        if (index === -1) throw new Error(`Child not present in parent: ${node.id}`);

        return {parent, index};
    }

    /** Check if `node` is contained, directly or indirectly, by the folder with
     * the specified ID. */
    isNodeInFolder(node: Node, folder_id: NodeID): boolean {
        let item: Node | undefined = node;
        while (item) {
            if (item.id === folder_id) return true;
            if (! item.parentId) break;
            item = this.by_id.get(item.parentId);
        }
        return false;
    }

    /** Given a bookmark node, return the path from the root to the node as an
     * array of NodePositions.  If the node is not present in the tree, throws
     * an exception. */
    pathTo(node: Node): NodePosition[] {
        const path = [];
        while (node.parentId) {
            const pos = this.positionOf(node);
            path.push(pos);
            node = pos.parent;
        }
        path.reverse();
        return path;
    }

    /** Return all the URLs present in the stash root. */
    urlsInStash(): Set<string> {
        const urls = new Set<string>();

        const urlsInChildren = (folder: Folder) => {
            for (const c of folder.children) {
                const node = this.node(c);
                if ('url' in node) urls.add(node.url);
                else if ('children' in node) urlsInChildren(node);
            }
        };

        if (this.stash_root.value) urlsInChildren(this.stash_root.value);

        return urls;
    }

    /** Find and return the stash root, or create one if it doesn't exist. */
    async ensureStashRoot(): Promise<Folder> {
        if (this.stash_root.value) return this.stash_root.value;

        await browser.bookmarks.create({title: this.stash_root_name});

        // Wait for a few ms so that if there are multiple calls happening in
        // different contexts (e.g. background, UIs etc.), we have a chance to
        // catch it and clean up duplicates.
        await new Promise(resolve => setTimeout(resolve, 4));

        let candidates = this._maybeUpdateStashRoot();

        // istanbul ignore if -- internal consistency
        if (! this.stash_root.value) {
            throw new Error(`Unable to locate newly-created stash root`);
        }

        // GROSS HACK to avoid creating duplicate roots follows.
        let retries = candidates.length;
        while (candidates.length > 1 && retries > 0) {
            // If we find MULTIPLE candidates so soon after finding NONE, there
            // must be multiple threads trying to create the root folder.  Let's
            // delete all but the first one.  We are guaranteed that all threads
            // see the same ordering of candidate folders (and thus will all
            // choose the same folder to save) because the sort is
            // deterministic.
            await browser.bookmarks.remove(candidates[1].id).catch(console.warn);
            candidates = this._maybeUpdateStashRoot();
            --retries;
        }
        // END GROSS HACK

        // istanbul ignore if -- internal consistency
        if (this.stash_root.value !== candidates[0]) {
            throw new Error("BUG: stash_root doesn't match candidate[0]");
        }

        return candidates[0];
    }

    //
    // Mutators
    //

    /** Moves a bookmark such that its index in the destination folder is
     * `toIndex`.
     *
     * Use this instead of `browser.bookmarks.move()`, which behaves differently
     * in Chrome and Firefox... */
    async move(id: NodeID, toParent: NodeID, toIndex: number): Promise<void> {
        // Firefox's `index` parameter behaves like the bookmark is first
        // removed, then re-added.  Chrome's/Edge's behaves like the bookmark is
        // first added, then removed from its old location, so the index of the
        // item after the move will sometimes be toIndex-1 instead of toIndex;
        // we account for this below.
        const node = this.by_id.get(id);
        // istanbul ignore if -- caller consistency
        if (! node) throw new Error(`No such bookmark: ${id}`);

        // istanbul ignore if
        if (! browser.runtime.getBrowserInfo) {
            // We're using Chrome
            if (node.parentId === toParent) {
                const position = this.positionOf(node);
                if (toIndex > position.index) toIndex++;
            }
        }
        await browser.bookmarks.move(id, {parentId: toParent, index: toIndex});
    }

    /** Removes the folder `folder_id` if it is empty and unnamed.
     * `last_child_id` is the ID of some child that was just removed from the
     * folder; if the child still appears to be present in the model, we will
     * assume it's just because the model hasn't been updated yet and remove the
     * folder anyway.
     *
     * But if any children OTHER than `last_child_id` appear in the folder, it
     * will be left untouched.
      */
    async removeFolderIfEmptyAndUnnamed(folder_id: NodeID) {
        const folder = this.by_id.get(folder_id);
        if (! folder || ! ('children' in folder)) return;

        // Folder does not have a default/unnamed-shape name
        if (getDefaultFolderNameISODate(folder.title) === null) return;

        // HACK: We wait for any pending model updates to happen here, because
        // this method is commonly called after deleting something that's in the
        // folder.  So we want to make doubly-sure the folder is actually empty
        // (and give the model a chance to catch up with any moves etc. that
        // happened out of the folder) before deleting it.
        //
        // Otherwise, we might get into model inconsistencies (e.g. if the
        // folder removal shows up before we've finished processing its
        // contents).
        await nextTick();

        if (folder.children.length > 0) return;
        await browser.bookmarks.remove(folder.id);
    }

    //
    // Events which are detected automatically by this model; these can be
    // called for testing purposes but otherwise you can ignore them.
    //
    // (In contrast to onFoo-style things, they are event listeners, not event
    // senders.)
    //

    whenBookmarkCreated(id: string, new_bm: Bookmarks.BookmarkTreeNode) {
        // istanbul ignore next -- this is kind of a dumb/redundant API, but it
        // must conform to browser.bookmarks.onCreated...
        if (id !== new_bm.id) throw new Error(`Bookmark IDs don't match`);

        const nodeId = id as NodeID;
        const parentId = (new_bm.parentId ?? '') as NodeID;

        // The parent must already exist and be a folder
        if (parentId) this.folder(parentId);

        let node = this.by_id.get(nodeId);
        if (! node) {
            if (isFolder(new_bm)) {
                node = reactive({
                    parentId: parentId, id: nodeId, dateAdded: new_bm.dateAdded,
                    title: new_bm.title ?? '', children: []
                });

            } else if (new_bm.type === 'separator') {
                node = reactive({
                    parentId: parentId, id: nodeId, dateAdded: new_bm.dateAdded,
                    type: 'separator' as 'separator', title: '' as '',
                });

            } else {
                node = reactive({
                    parentId: parentId, id: nodeId, dateAdded: new_bm.dateAdded,
                    title: new_bm.title ?? '', url: new_bm.url ?? '',
                });
                this._add_url(node);
            }

            this.by_id.set(node.id, node);

            if (new_bm.parentId) {
                const parent = this.folder(parentId);
                parent.children.splice(new_bm.index!, 0, node.id);
            }

        } else {
            // For idempotency, if the bookmark already exists, we merge the new
            // info we got with the existing record.

            // See if we have a parent, and insert/move ourselves there
            if (parentId) {
                // Remove from old parent
                if (node.parentId) {
                    const pos = this.positionOf(node);
                    pos.parent.children.splice(pos.index, 1);
                }

                // Add to new parent
                const parent = this.folder(parentId);
                parent.children.splice(new_bm.index!, 0, node.id);
            }

            // Merge title and URL
            if ('title' in node) node.title = new_bm.title;
            if ('url' in node) {
                this._remove_url(node);
                node.url = new_bm.url ?? '';
                this._add_url(node);
            }
            if ('dateAdded' in node) node.dateAdded = new_bm.dateAdded;
        }

        // If we got children, bring them in as well.
        if (isFolder(new_bm) && new_bm.children) {
            for (const child of new_bm.children) this.whenBookmarkCreated(child.id, child);
        }

        // Finally, see if this folder is a candidate for being a stash root.
        if ('children' in node) {
            if (node.title === this.stash_root_name) this._stash_root_watch.add(node);
            if (this._stash_root_watch.has(node)) this._maybeUpdateStashRoot();
        }
    }

    whenBookmarkChanged(id: string, info: Bookmarks.OnChangedChangeInfoType) {
        const node = this.by_id.get(id as NodeID);
        // istanbul ignore if
        if (! node) return; // out-of-order event delivery?

        if ('title' in info) {
            node.title = info.title;
            if ('children' in node && node.title === this.stash_root_name) {
                this._stash_root_watch.add(node);
            }
        }

        if (info.url !== undefined && 'url' in node) {
            this._remove_url(node);
            node.url = info.url;
            this._add_url(node);
        }

        // If this bookmark has been renamed to != this.stash_root_name,
        // _maybeUpdateStashRoot() will remove it from the watch set
        // automatically.
        if ('children' in node && this._stash_root_watch.has(node)) {
            this._maybeUpdateStashRoot();
        }
    }

    whenBookmarkMoved(id: string, info: {parentId: string, index: number}) {
        const node = this.by_id.get(id as NodeID);
        // istanbul ignore if
        if (! node) return; // out-of-order event delivery?

        const new_parent = this.folder(info.parentId as NodeID);

        const pos = this.positionOf(node);
        pos.parent.children.splice(pos.index, 1);

        node.parentId = info.parentId as NodeID;
        new_parent.children.splice(info.index, 0, node.id);

        if ('children' in node && this._stash_root_watch.has(node)) {
            this._maybeUpdateStashRoot();
        }
    }

    whenBookmarkRemoved(id: string) {
        const node = this.by_id.get(id as NodeID);
        if (! node) return;

        // We must remove children before their parents, so that we never have a
        // child referencing a parent that doesn't exist.
        if ('children' in node) {
            for (const c of Array.from(node.children)) this.whenBookmarkRemoved(c);
        }

        const pos = this.positionOf(node);
        pos.parent.children.splice(pos.index, 1);

        this.by_id.delete(node.id);
        if ('url' in node) this._remove_url(node);

        if ('children' in node && this._stash_root_watch.has(node)) {
            // We must explicitly remove `node` here because its title is
            // still "Tab Stash" even after it is deleted.
            this._stash_root_watch.delete(node);
            this._maybeUpdateStashRoot();
        }
    }

    /** Update `this.stash_root` if appropriate.  This function tries to be
     * fairly efficient in most cases since it is expected to be called quite
     * frequently.
     *
     * We avoid using watch() or watchEffect() here because we have to inspect
     * quite a few objects (starting from the root) to determine the stash root,
     * and so we want to minimize when this search is actually done. */
    private _maybeUpdateStashRoot(): Folder[] {
        // Collect the current candidate set from the watch, limiting ourselves
        // only to actual candidates (folders with the right name).
        let candidates = Array.from(this._stash_root_watch)
            .filter(bm => bm.children && bm.title === this.stash_root_name);

        // Find the path from each candidate to the root, and make sure we're
        // watching the whole path (so if a parent gets moved, we get called
        // again).
        const paths = filterMap(candidates, c => ({
            folder: c,
            path: this.pathTo(c),
        }));
        this._stash_root_watch = new Set(candidates);
        for (const p of paths) {
            for (const pos of p.path) this._stash_root_watch.add(pos.parent);
        }

        // Find the depth of the candidate closest to the root.
        const depth = Math.min(...paths.map(p => p.path.length));

        // Filter out candidates that are deeper than the minimum depth, and
        // sort the remainder in a stable fashion according to their creation
        // date and ID.
        candidates = paths
            .filter(p => p.path.length <= depth)
            .map(p => p.folder)
            .sort((a, b) => {
                const byDate = (a.dateAdded ?? 0) - (b.dateAdded ?? 0);
                if (byDate !== 0) return byDate;
                if (a.id < b.id) return -1;
                if (a.id > b.id) return 1;
                return 0;
            });

        // The actual stash root is the first candidate.
        this.stash_root.value = candidates[0];

        // But if we have multiple candidates, we need to raise the alarm that
        // there is an ambiguity the user should resolve.
        if (candidates.length > 1) {
            this.stash_root_warning.value = {
                text: `You have multiple "${this.stash_root_name}" bookmark `
                    + `folders, and Tab Stash isn't sure which one to use.  `
                    + `Click here to find out how to resolve the issue.`,
                help: /* istanbul ignore next */
                    () => browser.tabs.create({active: true, url: ROOT_FOLDER_HELP}),
            };
        } else {
            this.stash_root_warning.value = undefined;
        }

        // We return the candidate list here so that callers can see what
        // candidates are available (since there may be ways of resolving
        // conflicts we can't do here).
        return candidates;
    }

    //
    // Handling selection/deselection of bookmarks in the UI
    //

    isSelected(item: Node): boolean { return !!item.$selected; }

    async setSelected(items: Iterable<Node>, isSelected: boolean) {
        for (const item of items) item.$selected = isSelected;
    }

    *selectedItems(): Generator<Node> {
        const self = this;
        function* walk(bm: Node): Generator<Node> {
            if (bm.$selected) {
                yield bm;
                // If a parent is selected, we don't want to return every single
                // node in the subtree because this breaks drag-and-drop--we
                // would want to move a folder as a single unit, rather than
                // moving the folder, then all its children, then all their
                // children, and so on (effectively flattening the tree).
                return;
            }
            if ('children' in bm) {
                for (const c of bm.children) yield* walk(self.node(c));
            }
        }

        // We only consider items inside the stash root, since those are the
        // only items that show up in the UI.
        // istanbul ignore else -- when testing we should always have a root
        if (this.stash_root.value) yield* walk(this.stash_root.value);
    }

    itemsInRange(start: Node, end: Node): Node[] | null {
        let startPos = this.positionOf(start);
        let endPos = this.positionOf(end);

        if (startPos.parent !== endPos.parent) return null;

        if (endPos.index < startPos.index) {
            const tmp = endPos;
            endPos = startPos;
            startPos = tmp;
        }

        return startPos.parent.children
            .slice(startPos.index, endPos.index + 1)
            .map(id => this.node(id));
    }

    private _add_url(bm: Bookmark) {
        this.bookmarksWithURL(bm.url).add(bm);
    }

    private _remove_url(bm: Bookmark) {
        const index = this.by_url.get(bm.url);
        // istanbul ignore if -- internal consistency
        if (! index) return;
        index.delete(bm);
    }
}



//
// Public helper functions for dealing with folders under the stash root
//

/** Given a folder name, check if it's an "default"-shaped folder name (i.e.
 * just a timestamp) and return the timestamp portion of the name if so. */
 export function getDefaultFolderNameISODate(n: string): string | null {
    let m = n.match(/saved-([-0-9:.T]+Z)/);
    return m ? m[1] : null;
}

/** Generate a "default"-shaped folder name from a timestamp (usually the
 * timestamp of its creation). */
export function genDefaultFolderName(date: Date): string {
    return `saved-${date.toISOString()}`;
}

/** Given a folder name as it appears in the bookmarks tree, return a "friendly"
 * version to show to the user.  This translates folder names that look like a
 * "default"-shaped folder name into a user-friendly string, if applicable. */
export function friendlyFolderName(name: string): string {
    const folderDate = getDefaultFolderNameISODate(name);
    if (folderDate) return `Saved ${new Date(folderDate).toLocaleString()}`;
    return name;
}



//
// Helper functions for the model
//

/** A cross-browser compatible way to tell if `bm` is a folder or not. */
function isFolder(bm: Bookmarks.BookmarkTreeNode): boolean {
    if (bm.type === 'folder') return true; // for Firefox
    if (bm.children) return true; // for Chrome (sometimes)
    if (! ('type' in bm) && ! ('url' in bm)) return true; // for Chrome
    return false;
}
