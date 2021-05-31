import {browser, Types} from 'webextension-polyfill-ts';
import {beforeEach} from 'mocha';

import * as events from './events';

class Setting implements Types.Setting {
    private _value: any;

    readonly onChange = new events.MockEventDispatcher<
        (c: Types.SettingOnChangeDetailsType) => void>("browserSetting");

    async get(details: Types.SettingGetDetailsType):
        Promise<Types.SettingGetCallbackDetailsType>
    {
        return {
            value: this._value,
            levelOfControl: 'not_controllable',
        };
    }

    // istanbul ignore next
    async set(details: Types.SettingSetDetailsType): Promise<void> {
        this._value = details.value;
    }

    // istanbul ignore next
    async clear(details: Types.SettingClearDetailsType): Promise<void> {
        throw new Error("unimplemented");
    }
}

function reset() {
    // istanbul ignore if
    if (! (<any>globalThis).browser) (<any>globalThis).browser = {};
    browser.browserSettings = {
        allowPopupsForUserEvents: new Setting(),
        cacheEnabled: new Setting(),
        closeTabsByDoubleClick: new Setting(),
        contextMenuShowEvent: new Setting(),
        ftpProtocolEnabled: new Setting(),
        homepageOverride: new Setting(),
        imageAnimationBehavior: new Setting(),
        newTabPageOverride: new Setting(),
        newTabPosition: new Setting(),
        openBookmarksInNewTabs: new Setting(),
        openSearchResultsInNewTabs: new Setting(),
        openUrlbarResultsInNewTabs: new Setting(),
        webNotificationsDisabled: new Setting(),
        overrideDocumentColors: new Setting(),
        useDocumentFonts: new Setting(),
        zoomFullPage: new Setting(),
        zoomSiteSpecific: new Setting(),
    };
}

beforeEach(reset);
reset();

export default {reset};
