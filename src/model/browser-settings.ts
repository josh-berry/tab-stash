import {reactive} from "vue";
import {browser} from "webextension-polyfill-ts";

import {EventWiring, logErrors, resolveNamed} from "../util";

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

    /** TODO remove me -- use live() instead.  This only exists so we can
     * construct an object immediately, to support `stash.ts` for now. */
    static live_imm(): Model {
        const wiring = Model._wiring();
        const model = new Model({newtab_url: '', home_url: ''});
        wiring.wire(model);

        logErrors(async() => {
            model.state.newtab_url =
                (await browser.browserSettings.newTabPageOverride.get({})).value;
            model.state.home_url =
                (await browser.browserSettings.homepageOverride.get({})).value;
        });

        return model;
    }

    static async live(): Promise<Model> {
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
