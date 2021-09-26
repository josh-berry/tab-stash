import {reactive} from "vue";
import browser from "webextension-polyfill";

import {EventWiring, resolveNamed} from "../util";

export type State = {
    newtab_url: string;
    home_url: string;
};

/** This model keeps track of any browser settings which are relevant to Tab
 * Stash.  Mainly that's just the URLs of new-tab and home pages.
 *
 * All this exists mainly so we can answer the question, "is this URL a new-tab
 * URL?" immediately (without a promise/context switches back into the browser).
 */
export class Model {
    readonly state: State;

    static async live(): Promise<Model> {
        if (! browser.browserSettings) {
            // This is Chrome, which does not report the new-tab and homepage
            // URLs to extensions.  So we have to fall back to guessing/only
            // looking for built-in URLs.
            return new Model({
                newtab_url: 'about:newtab',
                home_url: 'about:blank',
            });
        }

        const wiring = Model._wiring();

        const state: State = await resolveNamed({
            newtab_url: browser.browserSettings.newTabPageOverride.get({})
                .then(s => s.value),
            home_url: browser.browserSettings.homepageOverride.get({})
                .then(s => s.value),
        });

        const model = new Model(state);
        wiring.wire(model);
        return model;
    }

    private static _wiring(): EventWiring<Model> {
        const wiring = new EventWiring<Model>();
        wiring.listen(browser.browserSettings.newTabPageOverride.onChange,
            'whenNewTabPageChanged');
        wiring.listen(browser.browserSettings.homepageOverride.onChange,
            'whenHomepageChanged');
        return wiring;
    }

    private constructor(state: State) {
        this.state = reactive(state);
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

    //
    // Events from the browser
    //

    whenNewTabPageChanged(setting: {value: string}) {
        this.state.newtab_url = setting.value;
    }

    whenHomepageChanged(setting: {value: string}) {
        this.state.home_url = setting.value;
    }
}
