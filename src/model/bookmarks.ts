import {reactive} from "vue";
import {Bookmarks, browser} from "webextension-polyfill-ts";

import {DeferQueue} from "../util";
import {Index} from "./util";

// We modify the type of .children here to make it readonly, since we want it to
// be managed by the model's index and not modified directly.
export type Bookmark = Omit<Bookmarks.BookmarkTreeNode, 'children'>
    & {children?: readonly Bookmark[]};

export type State = {
    $loaded: 'no' | 'loading' | 'yes',
    root?: Bookmark,
};

/** A Vue model for the state of the browser bookmark tree.
 *
 * Similar to `tabs.ts`, this model follows the WebExtension conventions, with
 * some slight changes to handle hierarchy in the same manner as `tabs.ts`, and
 * ensure the state is JSON-serializable.
 */
export class Model {
    readonly state: State;

    readonly by_id = new Map<string, Bookmark>();

    readonly by_parent = new Index<string | null, Bookmark>({
        keyFor: bm => bm.parentId ?? null,
        positionOf: bm => /* istanbul ignore next */ bm.index ?? Infinity,
        whenPositionChanged(bm, toIndex) { bm.index = toIndex; },
    });

    readonly by_url = new Index<string, Bookmark>({
        keyFor: bm => bm.url ?? '',
    });

    //
    // Loading data and wiring up events
    //

    constructor() {
        this.state = reactive({
            $loaded: 'no',
            root: undefined,
        });
    }

    // istanbul ignore next
    loadFromMemory(root: Bookmark) {
        if (this.state.$loaded !== 'no') return;

        this.whenBookmarkCreated(root);
        this.state.root = this.by_id.get(root.id);

        this._wire_events().unplug();
        this.state.$loaded = 'yes';
    }

    // istanbul ignore next
    async loadFromBrowser() {
        if (this.state.$loaded !== 'no') return;
        this.state.$loaded = 'loading';

        try {
            const evq = this._wire_events();

            const tree = await browser.bookmarks.getTree();
            this.whenBookmarkUpdated(tree[0].id, tree[0]);
            this.state.root = this.by_id.get(tree[0].id);

            evq.unplug();
            this.state.$loaded = 'yes';

        } catch (e) {
            this.state.$loaded = 'no';
            throw e;
        }
    }

    // istanbul ignore next
    private _wire_events(): DeferQueue {
        // Wire up browser events so that we update the state when the browser
        // tells us something has changed.  All the event handlers are wrapped
        // with DeferQueue.wrap() because we will start receiving events
        // immediately, even before the state has been constructed.
        //
        // This is by design--we record these events in the DeferQueue, and then
        // perform all the (asynchronous) queries needed to build the state.
        // However, these queries will race with the events we receive, and the
        // result of the query might be out-of-date compared to what info we get
        // from events.  So we queue and delay processing of any events until
        // the state is fully constructed.

        const evq = new DeferQueue();

        browser.bookmarks.onCreated.addListener(
            evq.wrap((id, bm) => this.whenBookmarkCreated(bm)));
        browser.bookmarks.onChanged.addListener(
            evq.wrap((id, info) => this.whenBookmarkUpdated(id, info)));
        browser.bookmarks.onMoved.addListener(
            evq.wrap((id, info) => this.whenBookmarkMoved(id, info)));
        browser.bookmarks.onRemoved.addListener(
            evq.wrap(id => this.whenBookmarkRemoved(id)));

        return evq;
    }

    //
    // Events which are detected automatically by this model; these can be
    // called for testing purposes but otherwise you can ignore them.
    //
    // (In contrast to onFoo-style things, they are event listeners, not event
    // senders.)
    //

    whenBookmarkCreated(newbm: Bookmark) {
        let bm = this.by_id.get(newbm.id);
        if (! bm) {
            bm = reactive(newbm);
            this.by_id.set(newbm.id, bm);
            this.by_parent.insert(bm);
            this.by_url.insert(bm);
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
            if (children) for (const c of children) this.whenBookmarkCreated(c);
        }
    }

    whenBookmarkUpdated(id: string, info: Bookmarks.OnChangedChangeInfoType) {
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
        this.by_parent.delete(bm);
        this.by_url.delete(bm);

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
