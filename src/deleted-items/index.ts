// istanbul ignore file -- launcher shim for the live UI

import launch from "../launch-vue";
import ui_model from "../ui-model";

import Main from "./index.vue";

launch(Main, async () => {
  const model = await ui_model();
  return {
    propsData: {
      state: model.deleted_items.state,
    },
    provide: {
      $model: model,
    },
    methods: {
      model() {
        return model;
      },
    },
  };
});
