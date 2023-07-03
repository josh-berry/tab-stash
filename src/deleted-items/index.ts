// istanbul ignore file -- launcher shim for the live UI

import the, {init} from "@/globals-ui";
import launch from "../launch-vue";

import Main from "./index.vue";

launch(Main, async () => {
  await init();

  return {
    propsData: {
      state: the.model.deleted_items.state,
    },
  };
});
