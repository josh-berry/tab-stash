// This file is auto-loaded so that it mocks up various global browser
// facilities BEFORE tests are run, and resets/verifies sanity AFTER tests are
// complete.

import {RootHookObject} from 'mocha';

(<any>globalThis).mock = {
    indexedDB: true,
    browser: true,
    events: true,
};

// Mock indexedDB.* APIs
import 'fake-indexeddb/auto';
const FDBFactory = require("fake-indexeddb/lib/FDBFactory");

// Event system which allows snooping on events
import * as events from './events';

// Mock browser.* APIs
(<any>globalThis).browser = {};
import 'webextension-polyfill';
import * as mock_browser from './browser';

export const mochaHooks: RootHookObject = {
    async beforeEach() {
        (<any>globalThis).indexedDB = new FDBFactory();
        events.beforeTest();
        mock_browser.runtime.reset();
        mock_browser.storage.reset();
        mock_browser.bookmarks.reset();
        mock_browser.tabs_and_windows.reset();
    },
    async afterEach() {
        await events.afterTest();
    },
};
