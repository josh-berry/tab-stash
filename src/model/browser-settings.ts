import {reactive} from "vue";
import browser from "webextension-polyfill";

import {backingOff, resolveNamed} from "../util/index.js";
import {logErrorsFrom} from "../util/oops.js";
import {EventWiring} from "../util/wiring.js";

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

  /** Did we receive an event since the last (re)load of the model? */
  private _event_since_load: boolean = false;

  static async live(): Promise<Model> {
    const model = new Model();
    await model.reload();
    return model;
  }

  private constructor() {
    this.state = reactive({
      newtab_url: "about:newtab",
      home_url: "about:blank",
    });

    // Chrome does not report browser settings, so we fallback to defaults.
    if (!browser.browserSettings) return;

    const wiring = new EventWiring(this, {
      onFired: () => {
        this._event_since_load = true;
      },
      onError: () => {
        logErrorsFrom(() => this.reload());
      },
    });

    wiring.listen(
      browser.browserSettings.newTabPageOverride.onChange,
      this.whenNewTabPageChanged,
    );
    wiring.listen(
      browser.browserSettings.homepageOverride.onChange,
      this.whenHomepageChanged,
    );
  }

  readonly reload = backingOff(async () => {
    // Chrome does not report browser settings, so we fallback to defaults.
    if (!browser.browserSettings) return;

    // Loop if we receive events while loading settings, so that we always
    // exit this function with the browser and the model in sync.
    this._event_since_load = true;
    while (this._event_since_load) {
      this._event_since_load = false;

      const state: State = await resolveNamed({
        newtab_url: browser.browserSettings.newTabPageOverride
          .get({})
          .then(s => s.value),
        home_url: browser.browserSettings.homepageOverride
          .get({})
          .then(s => s.value),
      });
      this.state.newtab_url = state.newtab_url;
      this.state.home_url = state.home_url;
    }
  });

  //
  // Accessors
  //

  /** Determine if the URL provided is a new-tab URL or homepage URL (i.e.
   * something the user would consider as "empty"). */
  isNewTabURL(url: string): boolean {
    // Every &$#*!&ing browser has its own new-tab URL...
    switch (url) {
      case this.state.newtab_url:
      case this.state.home_url:
      case "about:blank":
      case "about:newtab":
      case "chrome://newtab/":
      case "edge://newtab/":
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
