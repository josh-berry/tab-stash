// istanbul ignore file -- launcher shim for the live UI

import launch from "../launch-vue";

import * as Options from "../model/options";
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
