/* c8 ignore start -- launcher shim for the live UI */

import launch from "../launch-vue.js";

import * as Options from "../model/options.js";
import Main from "./index.vue";

launch(Main, async () => {
  const opts = await Options.Model.live();
  (<any>globalThis).model = opts;
  return {
    propsData: {
      model: opts,
    },
  };
});
