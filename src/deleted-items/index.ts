/* c8 ignore start -- launcher shim for the live UI */

import the from "../globals-ui.js";
import launch from "../launch-vue.js";

import {$t} from "../util/i18n.js";

import Main from "./index.vue";

launch(Main, async () => {
  document.title = $t("deletedItemsPageTitle");
  return {
    propsData: {
      state: the.model.deleted_items.state,
    },
  };
});
