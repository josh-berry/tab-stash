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

// Returns a function which, when called, arranges to call the async function
// /fn/ when the browser has some idle time.
//
// We ensure that only one instance of the function is running at a time.  If
// the function is requested to be run before the previous call has finished
// running, the request will be queued and the function will be re-run again.
//
// The async function is always called with no arguments.  The return value from
// its promise is ignored.
//
// Since this is ostensibly a background task, exceptions which bubble out of
// the function are caught and logged to the console.
export function whenIdle(fn) {
    let triggered = false;
    let pending = null;

    return () => {
        triggered = true;
        if (pending) return;

        pending = window.requestIdleCallback(async function() {
            while (triggered) {
                triggered = false;
                try {
                    await fn();
                } catch (e) {
                    console.log(e);
                }
            }
            pending = null;
        });
    };
}
