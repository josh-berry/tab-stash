import launch from '../launch-vue';

launch(require('./index.vue').default, async() => {
    const my_url = new URL(document.location.href);

    const url = my_url.searchParams.get('url');
    if (url) document.title = url;

    return {
        propsData: {url},
    };
});
