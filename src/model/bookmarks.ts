import {reactive} from "vue";
import {Bookmarks, browser} from "webextension-polyfill-ts";

import {EventWiring} from "../util";
import {EventfulMap, Index} from "./util";

// We modify the type of .children here to make it readonly, since we want it to
// be managed by the model's index and not modified directly.
export type Bookmark = Omit<Bookmarks.BookmarkTreeNode, 'children'>
    & {children?: readonly Bookmark[]};

/** A Vue model for the state of the browser bookmark tree.
 *
 * Similar to `tabs.ts`, this model follows the WebExtension conventions, with
 * some slight changes to handle hierarchy in the same manner as `tabs.ts`, and
 * ensure the state is JSON-serializable.
 */
export class Model {
    readonly root: Bookmark;

    readonly by_id = new EventfulMap<string, Bookmark>();

    readonly by_parent = new Index(this.by_id, {
        keyFor: bm => bm.parentId ?? null,
        positionOf: bm => /* istanbul ignore next */ bm.index ?? Infinity,
        whenPositionChanged(bm, toIndex) { bm.index = toIndex; },
    });

    readonly by_url = new Index(this.by_id, {
        keyFor: bm => bm.url ?? '',
    });

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
        this.whenBookmarkCreated(root.id, root);
        this.root = this.by_id.get(root.id)!;
    }

    //
    // Events which are detected automatically by this model; these can be
    // called for testing purposes but otherwise you can ignore them.
    //
    // (In contrast to onFoo-style things, they are event listeners, not event
    // senders.)
    //

    whenBookmarkCreated(id: string, newbm: Bookmark) {
        // istanbul ignore next -- this is kind of a dumb/redundant API, but it
        // must conform to browser.bookmarks.onCreated...
        if (id !== newbm.id) throw new Error(`Bookmark IDs don't match`);

        let bm = this.by_id.get(id);
        if (! bm) {
            bm = reactive(newbm);
            this.by_id.insert(newbm.id, bm);
        } else {
            // For idempotency, if the bookmark already exists, we merge the new
            // info we got with the existing record.
            Object.assign(bm, newbm);
        }

        if (isFolder(newbm)) {
            const children = newbm.children; // to avoid aliasing issues

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
        }
    }

    whenBookmarkChanged(id: string, info: Bookmarks.OnChangedChangeInfoType) {
        const bm = this.by_id.get(id);
        // istanbul ignore if
        if (! bm) return; // out-of-order event delivery?

        bm.title = info.title;
        if ('url' in info && ! bm.children) bm.url = info.url;
    }

    whenBookmarkMoved(id: string, info: {parentId: string, index: number}) {
        const bm = this.by_id.get(id);
        // istanbul ignore if
        if (! bm) return; // out-of-order event delivery?
        bm.parentId = info.parentId;
        bm.index = info.index;
    }

    whenBookmarkRemoved(id: string) {
        const bm = this.by_id.get(id);
        if (! bm) return;

        this.by_id.delete(id);

        if (bm.children) for (const c of Array.from(bm.children)) {
            this.whenBookmarkRemoved(c.id);
        }
    }
}

/** A cross-browser compatible way to tell if `bm` is a folder or not. */
function isFolder(bm: Bookmark): boolean {
    if (bm.type === 'folder') return true; // for Firefox
    if (bm.children) return true; // for Chrome (sometimes)
    if (! ('type' in bm) && ! ('url' in bm)) return true; // for Chrome
    return false;
}
