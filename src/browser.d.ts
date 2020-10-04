//
// Some TypeScript declarations on more recent browser APIs which are missing
// from web-ext-types
//

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs
declare namespace browser.tabs {
    function discard(tab_ids: number[]): Promise<void>;
    function update(
        tabId: number,
        updateProperties: {
            active?: boolean,
            autoDiscardable?: boolean,
            highlighted?: boolean,
            loadReplace?: boolean,
            muted?: boolean,
            openerTabId?: boolean,
            pinned?: boolean,
            successorTabId?: number,
            url?: string,
        },
    ): Promise<browser.tabs.Tab>;
}

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browserSettings
declare namespace browser.browserSettings {
    const allowPopupsForUserEvents: browser.types.BrowserSetting<boolean>;
    const cacheEnabled: browser.types.BrowserSetting<boolean>;
    const closeTabsByDoubleClick: browser.types.BrowserSetting<boolean>;
    const contextMenuShowEvent: browser.types.BrowserSetting<
        'mouseup' | 'mousedown'>;
    const homepageOverride: browser.types.BrowserSetting<string>;
    const imageAnimationBehavior: browser.types.BrowserSetting<
        'normal' | 'none' | 'once'>;
    const newTabPageOverride: browser.types.BrowserSetting<string>;
    const newTabPosition: browser.types.BrowserSetting<
        'afterCurrent' | 'relatedAfterCurrent' | 'atEnd'>;
    const openBookmarksInNewTabs: browser.types.BrowserSetting<boolean>;
    const openSearchResultsInNewTabs: browser.types.BrowserSetting<boolean>;
    const openUrlbarResultsInNewTabs: browser.types.BrowserSetting<boolean>;
    const overrideDocumentColors: browser.types.BrowserSetting<
        'high-contrast-only' | 'never' | 'always'>;
    const useDocumentFonts: browser.types.BrowserSetting<boolean>;
    const webNotificationsDisabled: browser.types.BrowserSetting<boolean>;
}

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/types
declare namespace browser.types {
    class BrowserSetting<T> {
        get(details: {}): Promise<BrowserSettingResult<T>>;
        set(details: {value: T}): Promise<boolean>;
        clear(details: {}): Promise<boolean>;
    }

    interface BrowserSettingResult<T> {
        value: T;
        levelOfControl: "not_controllable" | "controlled_by_other_extensions"
            | "controllable_by_this_extension"
            | "controlled_by_this_extension";
    }
}
