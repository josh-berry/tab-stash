import {reactive, Ref, ref} from "vue";
import {Bookmarks, browser} from "webextension-polyfill-ts";

import {EventWiring, filterMap, nextTick} from "../util";
import {EventfulMap, Index} from "./util";

// We modify the type of .children here to make it readonly, since we want it to
// be managed by the model's index and not modified directly.
export type Bookmark = Omit<Bookmarks.BookmarkTreeNode, 'children'>
    & {children?: readonly Bookmark[]};

/** The name of the stash root folder.  This name must match exactly (including
 * in capitalization). */
export const STASH_ROOT = 'Tab Stash';

const ROOT_FOLDER_HELP = 'https://github.com/josh-berry/tab-stash/wiki/Problems-Locating-the-Tab-Stash-Bookmark-Folder';

/** A Vue model for the state of the browser bookmark tree.
 *
 * Similar to `tabs.ts`, this model follows the WebExtension conventions, with
 * some slight changes to handle hierarchy in the same manner as `tabs.ts`, and
 * ensure the state is JSON-serializable.
 */
export class Model {
    readonly by_id = new EventfulMap<string, Bookmark>();

    readonly by_parent = new Index(this.by_id, {
        keyFor: bm => bm.parentId ?? null,
        positionOf: bm => /* istanbul ignore next */ bm.index ?? Infinity,
        whenPositionChanged(bm, toIndex) { bm.index = toIndex; },
    });

    readonly by_url = new Index(this.by_id, {
        keyFor: bm => bm.url ?? '',
    });

    /** The root folder for all of the user's bookmarks (Tab Stash or
     * otherwise).  You probably want `stash_root` instead. */
    readonly root: Bookmark;

    /** A Vue ref to the root folder for Tab Stash's saved tabs. */
    readonly stash_root: Ref<Bookmark | undefined> = ref();

    /** If set, there is more than one candidate stash root, and it's not clear
     * which one to use.  The contents of the warning are an error to show the
     * user and a function to direct them to more information. */
    readonly stash_root_warning: Ref<{text: string, help: () => void} | undefined> = ref();

    /** Tracks folders which are candidates to be the stash root, and their
     * parents (up to the root).  Any changes to these folders should recompute
     * the stash root. */
    private _stash_root_watch = new Set<Bookmark>();

    //
    // Loading data and wiring up events
    //

    /** Construct a model for testing use.  It will not listen to any browser
     * events and will not update itself--you must use the `when*()` methods to
     * update it manually. */
    static for_test(root: Bookmark): Model {
        return new Model(root);
    }

    // istanbul ignore next
    /** Construct a model by loading bookmarks from the browser bookmark store.
     * It will listen for bookmark events to keep itself updated. */
    static async from_browser(): Promise<Model> {
        const wiring = Model._wiring();
        const tree = await browser.bookmarks.getTree();

        const model = new Model(tree[0]!);
        wiring.wire(model);
        return model;
    }

    // istanbul ignore next
    /** Construct a model by loading it from an in-memory cache of the browser
     * bookmark store.  It will listen for bookmark events to keep itself
     * updated. */
    static from_cache(root: Bookmark): Model {
        const wiring = Model._wiring();
        const model = new Model(root);
        wiring.wire(model);
        return model;
    }

    // istanbul ignore next
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

    private constructor(root: Bookmark) {
        this.whenBookmarkCreated(root.id, root); // will set the stash root
        this.root = this.by_id.get(root.id)!;
    }

    //
    // Accessors
    //

    /** Check if `bm` is contained, directly or indirectly, by the folder with
     * the specified ID. */
    isBookmarkInFolder(bm: Bookmark, folder_id: string): boolean {
        let item: Bookmark | undefined = bm;
        while (item) {
            if (item.id === folder_id) return true;
            if (! item.parentId) return false;
            item = this.by_id.get(item.parentId);
        }
        return false;
    }

    /** Given a bookmark, return the path from the root to the bookmark.  May
     * return `undefined` if the path is not known (e.g. because the bookmark
     * isn't actually present in the tree).  The bookmark itself is included in
     * the return path (i.e. not all entries are Bookmarks). */
    pathTo(bm: Bookmark): Bookmark[] | undefined {
        const path = [bm];
        while (bm.parentId) {
            const parent = this.by_id.get(bm.parentId);
            if (! parent) return undefined;
            path.push(parent);
            bm = parent;
        }
        path.reverse();
        return path;
    }

    /** Find and return the stash root, or create one if it doesn't exist. */
    async ensureStashRoot(): Promise<Bookmark> {
        if (this.stash_root.value) return this.stash_root.value;

        await browser.bookmarks.create({title: STASH_ROOT});

        // Wait for the model to get updated
        let candidates = this._maybeUpdateStashRoot();
        for (let timeout = 10; timeout > 0; --timeout) {
            if (this.stash_root.value) break;
            await nextTick();
            candidates = this._maybeUpdateStashRoot();
        }

        if (! this.stash_root.value) {
            throw new Error(`Unable to locate newly-created stash root`);
        }

        // GROSS HACK to avoid creating duplicate roots follows.
        while (candidates.length > 1) {
            // If we find MULTIPLE candidates so soon after finding NONE, there
            // must be multiple threads trying to create the root folder.  Let's
            // delete all but the first one.  We are guaranteed that all threads
            // see the same ordering of candidate folders (and thus will all
            // choose the same folder to save) because the sort is
            // deterministic.
            console.log("Oops! Removing duplicate root:", candidates[1]);
            await browser.bookmarks.remove(candidates[1].id).catch(console.warn);
            candidates = this._maybeUpdateStashRoot();
        }
        console.log("Remaining root:", candidates[0]);
        // END GROSS HACK

        if (this.stash_root.value !== candidates[0]) {
            throw new Error("BUG: stash_root doesn't match candidate[0]");
        }

        return candidates[0];
    }

    //
    // Events which are detected automatically by this model; these can be
    // called for testing purposes but otherwise you can ignore them.
    //
    // (In contrast to onFoo-style things, they are event listeners, not event
    // senders.)
    //

    whenBookmarkCreated(id: string, new_bm: Bookmark) {
        // istanbul ignore next -- this is kind of a dumb/redundant API, but it
        // must conform to browser.bookmarks.onCreated...
        if (id !== new_bm.id) throw new Error(`Bookmark IDs don't match`);

        let bm = this.by_id.get(id);
        if (! bm) {
            bm = reactive(new_bm);
            this.by_id.insert(new_bm.id, bm);
        } else {
            // For idempotency, if the bookmark already exists, we merge the new
            // info we got with the existing record.
            Object.assign(bm, new_bm);
        }

        if (isFolder(new_bm)) {
            const children = new_bm.children; // to avoid aliasing issues

            // Make sure the children recorded in the bookmark always reflect
            // what's in the by_parent index (which maintains the invariant
            // between children, parentId and index).
            //
            // We only do this if we affirmatively know this node is a folder,
            // so it can be used as a reliable indicator of such, and .children
            // ALWAYS points to a reactive array which can be used to watch for
            // folder membership changes.
            bm.children = this.by_parent.get(bm.id);

            // Now, if we were given actual children, insert them.
            if (children) for (const c of children) this.whenBookmarkCreated(c.id, c);

            // Finally, see if this folder is a candidate for being a stash root.
            if (bm.title === STASH_ROOT) {
                this._stash_root_watch.add(bm);
                this._maybeUpdateStashRoot();
            }
        }
    }

    whenBookmarkChanged(id: string, info: Bookmarks.OnChangedChangeInfoType) {
        const bm = this.by_id.get(id);
        // istanbul ignore if
        if (! bm) return; // out-of-order event delivery?

        if ('title' in info) {
            bm.title = info.title;
            if (bm.children && bm.title === STASH_ROOT) this._stash_root_watch.add(bm);
        }

        if ('url' in info && ! bm.children) bm.url = info.url;

        // If this bookmark has been renamed to != STASH_ROOT,
        // _maybeUpdateStashRoot() will remove it from the watch set
        // automatically.
        if (bm.children && this._stash_root_watch.has(bm)) this._maybeUpdateStashRoot();
    }

    whenBookmarkMoved(id: string, info: {parentId: string, index: number}) {
        const bm = this.by_id.get(id);
        // istanbul ignore if
        if (! bm) return; // out-of-order event delivery?
        bm.parentId = info.parentId;
        bm.index = info.index;

        if (bm.children && this._stash_root_watch.has(bm)) this._maybeUpdateStashRoot();
    }

    whenBookmarkRemoved(id: string) {
        const bm = this.by_id.get(id);
        if (! bm) return;

        this.by_id.delete(id);

        if (bm.children) {
            for (const c of Array.from(bm.children)) {
                this.whenBookmarkRemoved(c.id);
            }
            if (this._stash_root_watch.has(bm)) {
                // We must explicitly remove `bm` here because its title is
                // still "Tab Stash" even after it is deleted.
                this._stash_root_watch.delete(bm);
                this._maybeUpdateStashRoot();
            }
        }
    }

    /** Update `this.stash_root` if appropriate.  This function tries to be
     * fairly efficient in most cases since it is expected to be called quite
     * frequently.
     *
     * We avoid using watch() or watchEffect() here because we have to inspect
     * quite a few objects (starting from the root) to determine the stash root,
     * and so we want to minimize when this search is actually done. */
    private _maybeUpdateStashRoot(): Bookmark[] {
        // Collect the current candidate set from the watch, limiting ourselves
        // only to actual candidates (folders with the right name).
        let candidates = Array.from(this._stash_root_watch)
            .filter(bm => bm.children && bm.title === STASH_ROOT);

        // Find the path from each candidate to the root, and make sure we're
        // watching the whole path (so if a parent gets moved, we get called
        // again).
        const paths = filterMap(candidates, c => this.pathTo(c));
        this._stash_root_watch = new Set();
        for (const p of paths) for (const bm of p) this._stash_root_watch.add(bm);

        // Find the depth of the candidate closest to the root.
        const depth = Math.min(...paths.map(p => p.length));

        // Filter out candidates that are deeper than the minimum depth, and
        // sort the remainder in a stable fashion according to their creation
        // date and ID.
        candidates = paths
            .filter(p => p.length <= depth)
            .map(p => p[p.length - 1])
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
                text: `You have multiple "${STASH_ROOT}" bookmark folders, and `
                    + `Tab Stash isn't sure which one to use.  Click here to `
                    + `find out how to resolve the issue.`,
                help: () => browser.tabs.create({active: true, url: ROOT_FOLDER_HELP}),
            };
        } else {
            this.stash_root_warning.value = undefined;
        }

        // We return the candidate list here so that callers can see what
        // candidates are available (since there may be ways of resolving
        // conflicts we can't do here).
        return candidates;
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
function isFolder(bm: Bookmark): boolean {
    if (bm.type === 'folder') return true; // for Firefox
    if (bm.children) return true; // for Chrome (sometimes)
    if (! ('type' in bm) && ! ('url' in bm)) return true; // for Chrome
    return false;
}
