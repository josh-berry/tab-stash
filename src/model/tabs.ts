import {reactive} from "vue";
import browser, {Tabs, Windows} from "webextension-polyfill";
import {EventWiring, filterMap} from "../util";
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
    readonly by_id = new EventfulMap<number, Tab>("tabs");

    readonly by_window = new Index(this.by_id, {
        keyFor: tab => tab.windowId,
        positionOf: tab => tab.index,
        whenPositionChanged(tab, toIndex) { tab.index = toIndex; },
    });

    readonly by_url = new Index(this.by_id, {
        keyFor: tab => tab.url ?? '',
    });

    current_window: number | undefined;

    //
    // Loading data and wiring up events
    //

    /** Construct a model by loading tabs from the browser.  The model will keep
     * itself updated by listening to browser events. */
    static async from_browser(): Promise<Model> {
        const wiring = Model._wiring();
        const tabs = await browser.tabs.query({});
        const win = await browser.windows.getCurrent();

        const model = new Model(tabs, win.id);
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
        wiring.listen(browser.windows.onCreated, 'whenWindowCreated');
        wiring.listen(browser.windows.onRemoved, 'whenWindowRemoved');
        wiring.listen(browser.tabs.onCreated, 'whenTabCreated');
        wiring.listen(browser.tabs.onUpdated, 'whenTabUpdated');
        wiring.listen(browser.tabs.onAttached, 'whenTabAttached');
        wiring.listen(browser.tabs.onMoved, 'whenTabMoved');
        wiring.listen(browser.tabs.onReplaced, 'whenTabReplaced');
        wiring.listen(browser.tabs.onActivated, 'whenTabActivated');
        wiring.listen(browser.tabs.onHighlighted, 'whenTabsHighlighted');
        wiring.listen(browser.tabs.onRemoved, 'whenTabRemoved');
        return wiring;
    }

    private constructor(tabs: Tabs.Tab[], current_window: number | undefined) {
        this.current_window = current_window;
        for (const t of tabs) this.whenTabCreated(t);
    }

    //
    // Accessors
    //

    /** Returns the active tab in the specified window (or in
     * `this.current_window`, if no window is specified). */
    activeTab(windowId?: number): Tab | undefined {
        if (windowId === undefined) windowId = this.current_window;
        if (windowId === undefined) return undefined;

        const tabs = this.by_window.get(windowId);
        if (! tabs) return undefined;

        return tabs.filter(t => t.active)[0];
    }

    //
    // User-level operations on tabs
    //

    /** Close the specified tabs, but leave the browser window open (and create
     * a new tab if necessary to keep it open). */
    async closeTabs(tabIds: number[]): Promise<void> {
        await this.refocusAwayFromTabs(tabIds);
        await browser.tabs.remove(tabIds);
    }

    /** If any of the provided tabIds are the active tab, change to a different
     * active tab.  If the tabIds include all open tabs in a window, create a
     * fresh new tab to activate.
     *
     * The intention here is to prep the browser window(s) so that it stays open
     * even if we close every tab in the window(s), and to move away from any
     * active tabs which we are about to close (so the browser doesn't stop us
     * from closing them).
     */
    async refocusAwayFromTabs(tabIds: number[]): Promise<void> {
        const closing_tabs = filterMap(tabIds, id => this.by_id.get(id));
        const active_tabs = closing_tabs.filter(t => t.active);

        // NOTE: We expect there to be at most one active tab per window.
        for (const active_tab of active_tabs) {
            const tabs_in_window = this.by_window.get(active_tab.windowId)
                .filter(t => ! t.hidden && ! t.pinned);
            const closing_tabs_in_window =
                closing_tabs.filter(t => t.windowId === active_tab.windowId);

            if (closing_tabs_in_window.length >= tabs_in_window.length) {
                // If we are about to close all visible tabs in the window, we
                // should open a new tab so the window doesn't close.
                await browser.tabs.create({active: true, windowId: active_tab.windowId});

            } else {
                // Otherwise we should make sure the currently-active tab isn't
                // a tab we are about to hide/discard.  The browser won't let us
                // hide the active tab, so we'll have to activate a different
                // tab first.
                //
                // We do this search a little strangely--first looking only at
                // tabs AFTER the tabs we're focusing away from, followed by
                // looking only at tabs BEFORE the tabs we're focusing away
                // from, to mimic the browser's behavior when closing the front
                // tab.

                const idx = active_tab.index;
                let candidates = tabs_in_window.slice(idx + 1);
                let focus_tab = candidates.find(
                    t => t.id !== undefined && ! tabIds.find(id => t.id === id));
                if (! focus_tab) {
                    candidates = tabs_in_window.slice(0, idx).reverse();
                    focus_tab = candidates.find(
                        t => t.id !== undefined && ! tabIds.find(id => t.id === id));
                }

                // We should always have a /focus_tab/ at this point, but if we
                // don't, it's better to fail gracefully by doing nothing.
                console.assert(focus_tab);
                // We filter out tabs with undefined IDs above #undef
                if (focus_tab) await browser.tabs.update(focus_tab.id!, {active: true});
            }
        }
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
        // Chrome doesn't tell us which tab was deactivated, so we have to
        // find it and mark it deactivated ourselves...
        const win = this.by_window.get(info.windowId);
        for (const t of win) t.active = false;

        const tab = this.by_id.get(info.tabId);
        // istanbul ignore else -- guardrail against misdelivered events
        if (tab) tab.active = true;
    }

    whenTabsHighlighted(info: Tabs.OnHighlightedHighlightInfoType) {
        for (const t of this.by_window.get(info.windowId)) {
            t.highlighted = info.tabIds.findIndex(id => id === t.id) !== -1;
        }
    }

    whenTabRemoved(tabId: number) {
        const t = this.by_id.get(tabId);
        if (! t) return;
        this.by_id.delete(tabId);
    }
};
