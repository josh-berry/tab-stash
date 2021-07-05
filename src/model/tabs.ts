import {reactive} from "vue";
import {browser, Tabs, Windows} from "webextension-polyfill-ts";
import {DeferQueue} from "../util";
import {Index} from "./util";

export type Tab = Tabs.Tab & {id: number, windowId: number};

export type State = {
    $loaded: 'no' | 'loading' | 'yes',
};

/** A Vue model for the state of all open browser windows and their tabs.
 *
 * This model basically follows the WebExtension API, but some things are
 * tweaked from the WebExtension types to deal with the fact that we're
 * maintaining a persistent, JSON-serializable data structure and not simply
 * passing tab info around transiently.
 *
 * We avoid any classes or circular references in the data itself so it is
 * JSON-serializable (for transmission between contexts).
 */
export class Model {
    readonly state: State;

    readonly by_id = new Map<number, Tab>();

    readonly by_window = new Index<number, Tab>({
        keyFor: tab => tab.windowId,
        positionOf: tab => tab.index,
        whenPositionChanged(tab, toIndex) { tab.index = toIndex; },
    });

    readonly by_url = new Index<string, Tab>({
        keyFor: tab => tab.url ?? '',
    });

    //
    // Loading data and wiring up events
    //

    constructor() {
        this.state = reactive({
            $loaded: 'no',
        });
    }

    // istanbul ignore next
    loadFromMemory(tabs: Tab[]) {
        if (this.state.$loaded !== 'no') return;

        for (const t of tabs) this.whenTabUpdated(t);

        this._wire_events().unplug();
        this.state.$loaded = 'yes';
    }

    // istanbul ignore next
    async loadFromBrowser() {
        if (this.state.$loaded !== 'no') return;
        this.state.$loaded = 'loading';

        try {
            // Start collecting events immediately per the explanation in
            // _wire_events().
            const evq = this._wire_events();

            for (const t of await browser.tabs.query({})) {
                this.whenTabUpdated(t as Tab);
            }

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

        browser.windows.onCreated.addListener(evq.wrap(
            win => this.whenWindowUpdated(win)));
        browser.windows.onRemoved.addListener(evq.wrap(
            id => this.whenWindowClosed(id)));

        browser.tabs.onCreated.addListener(evq.wrap(
            tab => this.whenTabUpdated(tab as Tab)));
        browser.tabs.onAttached.addListener(evq.wrap(
            (id, info) => this.whenTabMoved(id, info.newWindowId, info.newPosition)));
        browser.tabs.onMoved.addListener(evq.wrap(
            (id, info) => this.whenTabMoved(id, info.windowId, info.toIndex)));
        browser.tabs.onRemoved.addListener(evq.wrap(
            id => this.whenTabClosed(id)));
        browser.tabs.onReplaced.addListener(evq.wrap(
            (newId, oldId) => this.whenTabReplaced(newId, oldId)));
        browser.tabs.onUpdated.addListener(evq.wrap(
            (id, info, tab) => this.whenTabUpdated(tab as Tab)));
        browser.tabs.onActivated.addListener(evq.wrap(
            info => this.whenTabActivated(info)));

        return evq;
    }

    //
    // Events which are detected automatically by this model; these can be
    // called for testing purposes but otherwise you can ignore them.
    //
    // (In contrast to onFoo-style things, they are event listeners, not event
    // senders.)
    //

    whenWindowUpdated(win: Windows.Window) {
        // istanbul ignore else
        if (win.tabs !== undefined) {
            for (const t of win.tabs) this.whenTabUpdated(t as Tab);
        }
    }

    whenWindowClosed(winId: number) {
        const win = Array.from(this.by_window.get(winId));
        for (const t of win) {
            this.whenTabClosed(t.id);
        }
    }

    whenTabUpdated(tab: Tab) {
        let t = this.by_id.get(tab.id!);
        if (! t) {
            t = reactive(tab);
            this.by_id.set(tab.id!, t);
            this.by_window.insert(t);
            this.by_url.insert(t);
        } else {
            Object.assign(t, tab);
        }
    }

    whenTabMoved(tabId: number, toWinId: number, toIndex: number) {
        const t = this.by_id.get(tabId);
        // istanbul ignore if -- should only happen if events are misdelivered
        if (! t) return;
        t.windowId = toWinId;
        t.index = toIndex;
    }

    whenTabActivated(info: Tabs.OnActivatedActiveInfoType) {
        if (info.previousTabId !== undefined) {
            const prev = this.by_id.get(info.previousTabId);
            // istanbul ignore else -- guardrail against misdelivered events
            if (prev) prev.active = false;
        }

        const tab = this.by_id.get(info.tabId);
        // istanbul ignore else -- guardrail against misdelivered events
        if (tab) tab.active = true;
    }

    whenTabReplaced(newId: number, oldId: number) {
        const t = this.by_id.get(oldId);
        // istanbul ignore if -- should only happen if events are misdelivered
        if (! t) return;
        this.by_id.delete(oldId);

        this.whenTabClosed(newId);

        t.id = newId;
        this.by_id.set(newId, t);
    }

    whenTabClosed(tabId: number) {
        const t = this.by_id.get(tabId);
        if (! t) return;
        this.by_window.delete(t);
        this.by_url.delete(t);
        this.by_id.delete(tabId);
    }
};
