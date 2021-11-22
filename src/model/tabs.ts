import {computed, reactive, Ref, ref} from "vue";
import browser, {Tabs, Windows} from "webextension-polyfill";
import {filterMap, logErrors, nonReentrant, shortPoll, tryAgain} from "../util";
import {EventWiring} from "../util/wiring";

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
    discarded: boolean,

    $selected: boolean,
    readonly $visible: boolean,
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

    /** Ref to a function which filters tabs--if the function returns true, the
     * tab should be visible in the UI.  Each tab's `$visible` property will be
     * updated automatically when a function is assigned to this ref. */
    readonly filter: Ref<(t: Tab) => boolean> = ref((_: Tab) => true);

    /** The number of selected tabs. */
    readonly selectedCount = computed(() => {
        let count = 0;
        for (const _ of this.selectedItems()) ++count;
        return count;
    });

    /** Did we receive an event since the last (re)load of the model? */
    private _event_since_load: boolean = false;

    //
    // Loading data and wiring up events
    //

    /** Construct a model by loading tabs from the browser.  The model will keep
     * itself updated by listening to browser events. */
    static async from_browser(): Promise<Model> {
        const win = await browser.windows.getCurrent();

        const model = new Model(win.id as WindowID);
        await model.reload();
        return model;
    }

    private constructor(current_window?: WindowID) {
        this.current_window = current_window;

        const wiring = new EventWiring(this, {
            onFired: () => { this._event_since_load = true; },
            // istanbul ignore next -- safety net; reload the model in the event
            // of an unexpected exception.
            onError: () => { logErrors(() => this.reload()); },
        });

        wiring.listen(browser.windows.onCreated, this.whenWindowCreated);
        wiring.listen(browser.windows.onRemoved, this.whenWindowRemoved);
        wiring.listen(browser.tabs.onCreated, this.whenTabCreated);
        wiring.listen(browser.tabs.onUpdated, this.whenTabUpdated);
        wiring.listen(browser.tabs.onAttached, this.whenTabAttached);
        wiring.listen(browser.tabs.onMoved, this.whenTabMoved);
        wiring.listen(browser.tabs.onReplaced, this.whenTabReplaced);
        wiring.listen(browser.tabs.onActivated, this.whenTabActivated);
        wiring.listen(browser.tabs.onHighlighted, this.whenTabsHighlighted);
        wiring.listen(browser.tabs.onRemoved, this.whenTabRemoved);
    }

    /** Fetch tabs/windows from the browser again and update the model's
     * understanding of the world with the browser's data.  Use this if it looks
     * like the model has gotten out of sync with the browser (e.g. for crash
     * recovery). */
    readonly reload = nonReentrant(async () => {
        // We loop until we can complete a reload without receiving any
        // concurrent events from the browser--if we get a concurrent event, we
        // need to try loading again, since we don't know how the event was
        // ordered with respect to the query().
        this._event_since_load = true;
        while (this._event_since_load) {
            this._event_since_load = false;
            let tabs = await browser.tabs.query({});

            // We sort tabs by index so that they always get inserted into their
            // parent windows in the correct order, even if they're provided to
            // us out of order.
            tabs = tabs.sort((a, b) => a.index - b.index);
            for (const t of tabs) this.whenTabCreated(t);

            // Clean up any old tabs/windows that don't exist anymore.
            const old_tabs = new Set(this.tabs.keys());
            const old_windows = new Set(this.windows.keys());
            for (const t of tabs) {
                old_tabs.delete(t.id as TabID);
                old_windows.delete(t.windowId as WindowID);
            }
            for (const t of old_tabs) this.whenTabRemoved(t);
            for (const w of old_windows) this.whenWindowRemoved(w);
        }
    });

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

    /** Creates a new tab and waits for the model to reflect its existence. */
    async create(tab: browser.Tabs.CreateCreatePropertiesType): Promise<Tab> {
        const t = await browser.tabs.create(tab);
        return await shortPoll(() => {
            const tab = this.tabs.get(t.id as TabID);
            if (tab) return tab;
            tryAgain();
        });
    }

    /** Moves a tab such that it precedes the item with index `toIndex` in
     * the destination window.  (You can pass an index `>=` the length of the
     * windows's tab list to move the item to the end of the window.) */
    async move(id: TabID, toWindow: WindowID, toIndex: number): Promise<void> {
        // This method mainly exists to provide consistent behavior between
        // bookmarks.move() and tabs.move().
        const tab = this.tab(id);

        // Unlike browser.bookmarks.move(), browser.tabs.move() behaves the same
        // on both Firefox and Chrome.
        if (tab.windowId === toWindow) {
            const position = this.positionOf(tab);
            if (toIndex > position.index) toIndex--;
        }

        await browser.tabs.move(id, {windowId: toWindow, index: toIndex});
        await shortPoll(() => {
            const pos = this.positionOf(tab);
            if (pos.window.id !== toWindow || pos.index !== toIndex) tryAgain();
        });
    }

    /** Close the specified tabs, but leave the browser window open (and create
     * a new tab if necessary to keep it open). */
    async remove(tabIds: TabID[]): Promise<void> {
        await this.refocusAwayFromTabs(tabIds);
        await browser.tabs.remove(tabIds);
        await shortPoll(() => {
            if (tabIds.find(tid => this.tabs.has(tid)) !== undefined) tryAgain();
        });
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
                discarded: tab.discarded ?? false,

                $selected: false,
                $visible: computed(() => this.filter.value(t!)),
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
            t.discarded = tab.discarded ?? false;
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
        if (info.discarded !== undefined) t.discarded = info.discarded;
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

    isSelected(item: Tab): boolean { return item.$selected; }

    async clearSelection() {
        for (const t of this.tabs.values()) t.$selected = false;
    }

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
            .map(tid => this.tab(tid))
            .filter(t => ! t.hidden && ! t.pinned && t.$visible);
    }
};
