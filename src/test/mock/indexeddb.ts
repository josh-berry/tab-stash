import 'fake-indexeddb/auto';

export default (() => {
    const exports = {
        reset() {
            // Ugly hack to reach in and clear the internal list of databases in
            // fake-indexeddb so it appears we are starting with no databases at
            // all. :/ Doesn't respect close() or versionChange or anything
            // else.
            (<any>indexedDB)._databases = new Map();
        },

        drain(): Promise<number> {
            // Hack to wait on indexedDB queued events.  Wish fake-indexeddb
            // actually exposed an API for this...
            return new Promise(resolve => {
                setImmediate(() => resolve(0));
            });
        },
    };

    exports.reset();

    return exports;
})();
