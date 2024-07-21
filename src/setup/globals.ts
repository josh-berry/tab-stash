/* c8 ignore start -- live globals for the setup UI */

import browser from "webextension-polyfill";

import * as Options from "../model/options.js";

/** Global variables.  The core conceit here is these are all initialized as
 * `undefined!`, and then initialized properly in the async `init()` function
 * which must be called on startup. */
const the = {
  /** The version number of Tab Stash. */
  version: undefined! as string,

  /** The options model. */
  options: undefined! as Options.Model,
};
export default the;

(<any>globalThis).the = the;

/** Must be called before trying to create this component. */
export async function init() {
  the.version = (await browser.management.getSelf()).version;
  the.options = await Options.Model.live();
}
