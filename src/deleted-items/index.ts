// istanbul ignore file -- launcher shim for the live UI

import {Model} from "@/model";
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
      [Model.injectionKey as symbol]: model,
    },
    methods: {
      model() {
        return model;
      },
    },
  };
});
