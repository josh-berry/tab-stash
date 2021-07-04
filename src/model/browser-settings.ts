/** This model keeps track of any browser settings which are relevant to Tab
 * Stash.  Mainly that's just the URLs of new-tab and home pages.
 *
 * All this exists mainly so we can answer the question, "is this URL a new-tab
 * URL?" immediately (without a promise/context switches back into the browser).
 */

import {reactive} from "vue";
import {browser} from "webextension-polyfill-ts";
import {DeferQueue, resolveNamed} from "../util";

export type State = {
    $loaded: 'no' | 'loading' | 'yes';
    newtab_url: string;
    home_url: string;
};

export class Model {
    readonly state: State = reactive({
        $loaded: 'no',
        newtab_url: '',
        home_url: '',
    });

    // TODO loadFromMemory() initializer if needed for testing

    async loadFromBrowser(): Promise<void> {
        this.state.$loaded = 'loading';
        try {
            const evq = this._wire_events();
            const urls = await resolveNamed({
                newtab_url: browser.browserSettings.newTabPageOverride.get({})
                    .then(s => s.value),
                home_url: browser.browserSettings.homepageOverride.get({})
                    .then(s => s.value),
            });
            Object.assign(this.state, urls);
            this.state.$loaded = 'yes';
            evq.unplug();
        } catch (e) {
            this.state.$loaded = 'no';
            throw e;
        }
    }

    private _wire_events(): DeferQueue {
        const evq = new DeferQueue();
        browser.browserSettings.newTabPageOverride.onChange.addListener(
            evq.wrap(s => this.state.newtab_url = s.value));
        browser.browserSettings.homepageOverride.onChange.addListener(
            evq.wrap(s => this.state.home_url = s.value));
        return evq;
    }

    /** Determine if the URL provided is a new-tab URL or homepage URL (i.e.
     * something the user would consider as "empty"). */
    isNewTabURL(url: string): boolean {
        // Every &$#*!&ing browser has its own new-tab URL...
        switch (url) {
            case this.state.newtab_url:
            case this.state.home_url:
            case 'about:blank':
            case 'about:newtab':
            case 'chrome://newtab/':
            case 'edge://newtab/':
                return true;
            default:
                // Vivaldi is especially difficult...
                if (url.startsWith("chrome://vivaldi-webui/startpage")) return true;
                return false;
        }
    }
}
