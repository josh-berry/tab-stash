import {reactive} from "vue";
import {browser, Tabs, Windows} from "webextension-polyfill-ts";
import {EventWiring} from "../util";
import {EventfulMap, Index} from "./util";

export type Tab = Tabs.Tab & {id: number, windowId: number};

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
    readonly by_id = new EventfulMap<number, Tab>();

    readonly by_window = new Index(this.by_id, {
        keyFor: tab => tab.windowId,
        positionOf: tab => tab.index,
        whenPositionChanged(tab, toIndex) { tab.index = toIndex; },
    });

    readonly by_url = new Index(this.by_id, {
        keyFor: tab => tab.url ?? '',
    });

    //
    // Loading data and wiring up events
    //

    /** Construct a model for testing use.  It will not listen to any browser
     * events and will not update itself--you must use the `when*()` methods to
     * update it manually. */
    static for_test(tabs: Tab[]): Model {
        return new Model(tabs);
    }

    // istanbul ignore next
    /** Construct a model by loading tabs from the browser.  The model will keep
     * itself updated by listening to browser events. */
    static async from_browser(): Promise<Model> {
        const wiring = Model._wiring();
        const tabs = await browser.tabs.query({});

        const model = new Model(tabs);
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
        wiring.listen(browser.windows.onCreated, 'whenWindowCreated');
        wiring.listen(browser.windows.onRemoved, 'whenWindowRemoved');
        wiring.listen(browser.tabs.onCreated, 'whenTabCreated');
        wiring.listen(browser.tabs.onUpdated, 'whenTabUpdated');
        wiring.listen(browser.tabs.onAttached, 'whenTabAttached');
        wiring.listen(browser.tabs.onMoved, 'whenTabMoved');
        wiring.listen(browser.tabs.onReplaced, 'whenTabReplaced');
        wiring.listen(browser.tabs.onActivated, 'whenTabActivated');
        wiring.listen(browser.tabs.onRemoved, 'whenTabRemoved');
        return wiring;
    }

    private constructor(tabs: Tabs.Tab[]) {
        for (const t of tabs) this.whenTabCreated(t);
    }

    //
    // Events which are detected automatically by this model; these can be
    // called for testing purposes but otherwise you can ignore them.
    //
    // (In contrast to onFoo-style things, they are event listeners, not event
    // senders.)
    //

    whenWindowCreated(win: Windows.Window) {
        // istanbul ignore else
        if (win.tabs !== undefined) {
            for (const t of win.tabs) this.whenTabCreated(t);
        }
    }

    whenWindowRemoved(winId: number) {
        const win = Array.from(this.by_window.get(winId));
        for (const t of win) this.whenTabRemoved(t.id);
    }

    whenTabCreated(tab: Tabs.Tab) {
        let t = this.by_id.get(tab.id!);
        if (! t) {
            // CAST: Tabs.Tab says the id should be optional, but it isn't...
            t = reactive(tab as Tab);
            this.by_id.insert(tab.id!, t);
        } else {
            Object.assign(t, tab);
        }
    }

    whenTabUpdated(id: number, info: Tabs.OnUpdatedChangeInfoType) {
        const t = this.by_id.get(id);
        // istanbul ignore next -- defensive coding for internal inconsistency
        if (! t) return;
        Object.assign(t, info);
    }

    whenTabAttached(id: number, info: Tabs.OnAttachedAttachInfoType) {
        this.whenTabMoved(id,
            {windowId: info.newWindowId, toIndex: info.newPosition});
    }

    whenTabMoved(tabId: number, info: {windowId: number, toIndex: number}) {
        const t = this.by_id.get(tabId);
        // istanbul ignore if -- should only happen if events are misdelivered
        if (! t) return;
        t.windowId = info.windowId;
        t.index = info.toIndex;
    }

    whenTabReplaced(newId: number, oldId: number) {
        const t = this.by_id.get(oldId);
        // istanbul ignore if -- should only happen if events are misdelivered
        if (! t) return;

        // The following is unnecessary; the map will take care of it for us.
        // If we ever do anything more complicated than by_id.delete() in here,
        // we may need to revisit this.
        //
        // this.whenTabClosed(newId);

        this.by_id.move(oldId, newId);
        t.id = newId;
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

    whenTabRemoved(tabId: number) {
        const t = this.by_id.get(tabId);
        if (! t) return;
        this.by_id.delete(tabId);
    }
};
