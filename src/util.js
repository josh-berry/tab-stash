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

// A class which wraps an async function that is to be run only while the
// browser is idle, and ensures that only one instance of the function is
// running at a time.  If the function is requested to be run before the
// previous instance has finished running, the request will be queued and the
// function will be re-run again.
//
// The async function is always called with no arguments, and if it is a
// classical function (not an arrow function), it will be called with `this` as
// the IdleWorker.  The return value from its promise is ignored.
//
// Since this is ostensibly a background task, exceptions which bubble out of
// the function are caught and logged to the console.
export class IdleWorker {
    constructor(fn) {
        this.fn = fn;
        this._triggered = false;
        this._pending = null;
    }

    trigger() {
        this._triggered = true;
        if (this._pending) return;

        const self = this;
        this._pending = window.requestIdleCallback(async function() {
            while (self._triggered) {
                self._triggered = false;
                try {
                    await self.fn();
                } catch (e) {
                    console.log(e);
                }
            }
            self._pending = null;
        });
    }
}
