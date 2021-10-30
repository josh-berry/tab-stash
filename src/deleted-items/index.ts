import launch from '../launch-vue';
import ui_model from '../ui-model';

launch(require('./index.vue').default, async() => {
    const model = await ui_model();
    return {
        propsData: {
            state: model.deleted_items.state,
        },
        provide: {
            $model: model,
        },
        methods: {
            model() { return model; },
        },
    };
});
