import {reactive} from "vue";
import browser, {Tabs, Windows} from "webextension-polyfill";
import {EventWiring, filterMap} from "../util";

export type Window = {
    readonly id: WindowID,
    readonly tabs: TabID[],
};
export type Tab = {
    windowId: WindowID,
    id: TabID,
    status: Tabs.TabStatus,
    title: string,
    url: string,
    favIconUrl: string,
    pinned: boolean,
    hidden: boolean,
    active: boolean,
    highlighted: boolean,

    $selected?: boolean,
};

export type WindowID = number & {readonly __window_id: unique symbol};
export type TabID = number & {readonly __tab_id: unique symbol};

export type TabPosition = {window: Window, index: number};

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
    private readonly windows = new Map<WindowID, Window>();
    private readonly tabs = new Map<TabID, Tab>();
    private readonly tabs_by_url = new Map<string, Set<Tab>>();

    current_window: WindowID | undefined;

    //
    // Loading data and wiring up events
    //

    /** Construct a model by loading tabs from the browser.  The model will keep
     * itself updated by listening to browser events. */
    static async from_browser(): Promise<Model> {
        const wiring = Model._wiring();
        const tabs = await browser.tabs.query({});
        const win = await browser.windows.getCurrent();

        const model = new Model(tabs, win.id as WindowID);
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

    private constructor(tabs: Tabs.Tab[], current_window?: WindowID) {
        this.current_window = current_window;
        for (const t of tabs) this.whenTabCreated(t);
    }

    //
    // Accessors
    //

    window(id: WindowID): Window {
        const win = this.windows.get(id);
        if (! win) throw new Error(`No such window: ${id}`);
        return win;
    }

    tab(id: TabID): Tab {
        const tab = this.tabs.get(id);
        if (! tab) throw new Error(`No such tab: ${id}`);
        return tab;
    }

    /** Returns the parent window of the tab, and the index of the tab in that
     * parent window's .tabs array. */
    positionOf(tab: Tab): TabPosition {
        const window = this.window(tab.windowId);
        const index = window.tabs.findIndex(tid => tid === tab.id);

        // istanbul ignore next -- internal sanity
        if (index === -1) throw new Error(`Tab not in its parent window: ${tab.id}`);
        return {window, index};
    }

    /** Returns the active tab in the specified window (or in
     * `this.current_window`, if no window is specified). */
    activeTab(windowId?: WindowID): Tab | undefined {
        if (windowId === undefined) windowId = this.current_window;
        if (windowId === undefined) return undefined;

        return this.window(windowId).tabs
            .map(t => this.tab(t))
            .filter(t => t.active)[0];
    }

    /** Returns a reactive set of tabs with the specified URL. */
    tabsWithURL(url: string): Set<Tab> {
        let index = this.tabs_by_url.get(url);
        if (! index) {
            index = reactive(new Set<Tab>());
            this.tabs_by_url.set(url, index);
        }
        return index;
    }

    //
    // User-level operations on tabs
    //

    /** Close the specified tabs, but leave the browser window open (and create
     * a new tab if necessary to keep it open). */
    async closeTabs(tabIds: TabID[]): Promise<void> {
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
    async refocusAwayFromTabs(tabIds: TabID[]): Promise<void> {
        const closing_tabs = filterMap(tabIds, id => this.tabs.get(id));
        const active_tabs = closing_tabs.filter(t => t.active);

        // NOTE: We expect there to be at most one active tab per window.
        for (const active_tab of active_tabs) {
            const tabs_in_window = this.window(active_tab.windowId).tabs
                .map(t => this.tab(t))
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

                const idx = this.positionOf(active_tab).index;
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
        const wid = win.id as WindowID;
        let window = this.windows.get(wid);
        if (! window) {
            window = reactive({id: wid, tabs: []});
            this.windows.set(wid, window);
        }
        // istanbul ignore else
        if (win.tabs !== undefined) {
            for (const t of win.tabs) this.whenTabCreated(t);
        }
    }

    whenWindowRemoved(winId: number) {
        const win = this.windows.get(winId as WindowID);
        if (! win) return;

        // We clone the array to avoid disturbances while iterating
        for (const t of Array.from(win.tabs)) this.whenTabRemoved(t);
        this.windows.delete(winId as WindowID);
    }

    whenTabCreated(tab: Tabs.Tab) {
        let t = this.tabs.get(tab.id as TabID);
        if (! t) {
            // CAST: Tabs.Tab says the id should be optional, but it isn't...
            t = reactive({
                windowId: tab.windowId as WindowID,
                id: tab.id as TabID,
                status: tab.status as Tabs.TabStatus ?? 'loading',
                title: tab.title ?? '',
                url: tab.url ?? '',
                favIconUrl: tab.favIconUrl ?? '',
                pinned: tab.pinned,
                hidden: tab.hidden ?? false,
                active: tab.active,
                highlighted: tab.highlighted,
            });
            this.tabs.set(tab.id as TabID, t);
        } else {
            // Remove this tab from its prior position
            if (this.windows.get(tab.windowId as WindowID)) {
                const pos = this.positionOf(t);
                pos.window.tabs.splice(pos.index, 1);
            }
            this._remove_url(t);

            t.windowId = tab.windowId as WindowID;
            t.status = tab.status as Tabs.TabStatus ?? 'loading';
            t.title = tab.title ?? '';
            t.url = tab.url ?? '';
            t.favIconUrl = tab.favIconUrl ?? '';
            t.pinned = tab.pinned;
            t.hidden = tab.hidden ?? false;
            t.active = tab.active;
            t.highlighted = tab.highlighted;
        }

        // Insert the tab in its new position in the window
        const wid = tab.windowId as WindowID;
        let win = this.windows.get(wid);
        if (! win) {
            win = reactive({id: wid, tabs: []});
            this.windows.set(wid, win);
        }
        win.tabs.splice(tab.index, 0, tab.id as TabID);

        // Insert the tab in its index
        this._add_url(t);
    }

    whenTabUpdated(id: number, info: Tabs.OnUpdatedChangeInfoType) {
        const t = this.tab(id as TabID);
        if (info.status !== undefined) t.status = info.status as Tabs.TabStatus;
        if (info.title !== undefined) t.title = info.title;
        if (info.url !== undefined) {
            this._remove_url(t);
            t.url = info.url;
            this._add_url(t);
        }
        if (info.favIconUrl !== undefined) t.favIconUrl = info.favIconUrl;
        if (info.pinned !== undefined) t.pinned = info.pinned;
        if (info.hidden !== undefined) t.hidden = info.hidden;
    }

    whenTabAttached(id: number, info: Tabs.OnAttachedAttachInfoType) {
        this.whenTabMoved(id,
            {windowId: info.newWindowId, toIndex: info.newPosition});
    }

    whenTabMoved(tabId: number, info: {windowId: number, toIndex: number}) {
        const t = this.tab(tabId as TabID);

        const oldPos = this.positionOf(t);
        oldPos.window.tabs.splice(oldPos.index, 1);

        const newWindow = this.window(info.windowId as WindowID);
        t.windowId = info.windowId as WindowID;
        newWindow.tabs.splice(info.toIndex, 0, t.id);
    }

    whenTabReplaced(newId: number, oldId: number) {
        const t = this.tab(oldId as TabID);
        const win = this.window(t.windowId);
        const idx = win.tabs.findIndex(tid => t.id === tid);

        t.id = newId as TabID;
        // istanbul ignore else -- internal sanity
        if (idx >= 0) win.tabs[idx] = t.id;

        this.tabs.delete(oldId as TabID);
        this.tabs.set(t.id, t);
    }

    whenTabActivated(info: Tabs.OnActivatedActiveInfoType) {
        // Chrome doesn't tell us which tab was deactivated, so we have to
        // find it and mark it deactivated ourselves...
        const win = this.window(info.windowId as WindowID);
        for (const tid of win.tabs) this.tab(tid).active = false;

        const tab = this.tab(info.tabId as TabID);
        tab.active = true;
    }

    whenTabsHighlighted(info: Tabs.OnHighlightedHighlightInfoType) {
        for (const tid of this.window(info.windowId as WindowID).tabs) {
            const t = this.tab(tid);
            t.highlighted = info.tabIds.findIndex(id => id === t.id) !== -1;
        }
    }

    whenTabRemoved(tabId: number) {
        const t = this.tabs.get(tabId as TabID);
        if (! t) return; // tab is already removed
        const pos = this.positionOf(t);

        this.tabs.delete(t.id);
        pos.window.tabs.splice(pos.index, 1);
        this._remove_url(t);
    }

    private _add_url(t: Tab) {
        this.tabsWithURL(t.url).add(t);
    }

    private _remove_url(t: Tab) {
        const index = this.tabs_by_url.get(t.url);
        // istanbul ignore if -- internal consistency
        if (! index) return;
        index.delete(t);
    }

    //
    // Handling selection/deselection of tabs in the UI
    //

    isSelected(item: Tab): boolean { return !!item.$selected; }

    async setSelected(items: Iterable<Tab>, isSelected: boolean) {
        for (const item of items) item.$selected = isSelected;
    }

    *selectedItems(): Generator<Tab> {
        // We only allow tabs in the current window to be selected
        // istanbul ignore if -- shouldn't occur in tests
        if (this.current_window === undefined) return;
        const tabs = this.window(this.current_window).tabs;
        for (const tid of tabs) {
            const t = this.tab(tid);
            if (t.$selected) yield t;
        }
    }

    itemsInRange(start: Tab, end: Tab): Tab[] | null {
        // istanbul ignore if -- shouldn't occur in tests
        if (this.current_window === undefined) return null;
        if (start.windowId !== this.current_window) return null;
        if (end.windowId !== this.current_window) return null;

        let startPos = this.positionOf(start);
        let endPos = this.positionOf(end);

        if (endPos.index < startPos.index) {
            const tmp = endPos;
            endPos = startPos;
            startPos = tmp;
        }

        return this.window(this.current_window).tabs
            .slice(startPos.index, endPos.index + 1)
            .map(tid => this.tab(tid));
    }
};
