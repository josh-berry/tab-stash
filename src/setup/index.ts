/* c8 ignore start -- launcher shim for the live UI */

import launch from "../launch-vue.js";

import {init} from "./globals.js";
import Main from "./index.vue";

launch(Main, async () => {
  await init();

  return {
    propsData: {},
  };
});
