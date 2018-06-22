// Things which are not specific to Tab Stash or browser functionality go here.

export function urlsInTree(bm_tree) {
    let urls = [];
    function collect(bm) {
        if (bm.type === 'folder') {
            if (bm.children) for (let c of bm.children) collect(c);
        } else if (bm.url) {
            urls.push(bm.url);
        }
    }
    collect(bm_tree);
    return urls;
}

export function asyncEvent(async_fn) {
    return function() {
        async_fn.apply(this, arguments).catch(console.log);
    };
}
