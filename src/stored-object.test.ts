import {expect} from 'chai';

//
// Mocks
//

class MockEventDispatcher<Fn extends Function> {
    _listeners: Fn[] = [];
    _pending: any[] = [];

    addListener(l: Fn) {
        expect(l).to.be.a('function');
        this._listeners.push(l);
    }

    send(...args: any[]) {
        this._pending.push(args);
    }

    drain(count: number) {
        expect(this._pending.length).to.equal(count);
        while (this._pending.length > 0) {
            let p = this._pending;
            this._pending = [];
            for (let ev of p) for (let f of this._listeners) f(...ev);
        }
    }
}

// Alternate route to access the onChanged listener so TypeScript doesn't get
// mad.  This object is replaced for each test.
let storage_events = new MockEventDispatcher<StorageChangedFn>();

class MockStorageArea {
    _area: browser.storage.StorageName;
    _storage: {[k: string]: string} = {};

    constructor(area: browser.storage.StorageName) {
        this._area = area;
    }

    async get(keys: string | string[] | null)
        : Promise<browser.storage.StorageObject>
    {
        if (! keys) {
            keys = Object.keys(this._storage);
        } else if (typeof keys === 'string') {
            keys = [keys];
        }

        let res: browser.storage.StorageObject = {};
        for (let k of keys) {
            if (k in this._storage) res[k] = JSON.parse(this._storage[k]);
        }

        return Promise.resolve(res);
    }

    async set(obj: browser.storage.StorageObject): Promise<void> {
        let ev: browser.storage.ChangeDict = {};
        for (let k of Object.keys(obj)) {
            let v = JSON.stringify(obj[k]);

            ev[k] = {newValue: JSON.parse(v)};
            if (k in this._storage) {
                ev[k].oldValue = JSON.parse(this._storage[k]);
            }

            this._storage[k] = v;
        }

        storage_events.send(ev, this._area);
        return Promise.resolve();
    }

    async remove(keys: string | string[]): Promise<void> {
        if (typeof keys === 'string') keys = [keys];

        let ev: browser.storage.ChangeDict = {};

        for (let k of keys) {
            if (k in this._storage) {
                ev[k] = {oldValue: JSON.parse(this._storage[k])};
                delete this._storage[k];
            }
        }

        storage_events.send(ev, this._area);
        return Promise.resolve();
    }

    clear() {
        return this.remove(Object.keys(this._storage));
    }
}

type StorageChangedFn = (changes: browser.storage.ChangeDict,
                         area: browser.storage.StorageName) => void;

function setupMocks() {
    storage_events = new MockEventDispatcher<StorageChangedFn>();
    (<any>browser).storage = {
        local: new MockStorageArea('local'),
        sync: new MockStorageArea('sync'),
        onChanged: storage_events,
    };
}



//
// Tests
//

describe('stored-object', function() {
    beforeEach(function() {
        setupMocks();
    });

    describe('mocks', function() {
        it('stores and retrieves single values', async function() {
            const obj = {foo: 'bar'};
            await browser.storage.local.set(obj);
            expect(await browser.storage.local.get('foo')).to.deep.equal(obj);
        });

        it('stores and retrieves multiple values', async function() {
            const obj = {
                foo: 'bar',
                obj: {a: 1, b: 2},
            };
            await browser.storage.local.set(obj);
            expect(await browser.storage.local.get(['foo', 'obj']))
                .to.deep.equal(obj);
        });

        it('deletes single values', async function() {
            await browser.storage.local.set({foo: 'bar'});
            await browser.storage.local.remove('foo');
            expect(await browser.storage.local.get()).to.deep.equal({});
        });

        it('deletes multiple values', async function() {
            await browser.storage.local.set({foo: 'bar', bar: 'baz'});
            await browser.storage.local.remove(['foo', 'bar']);
            expect(await browser.storage.local.get()).to.deep.equal({});
        });

        it('is empty on startup', async function() {
            expect(await browser.storage.local.get()).to.deep.equal({});
        });

        it('delivers events on object creation', async function() {
            let fired = false;
            storage_events.addListener((changes, area) => {
                expect('oldValue' in changes.foo).to.equal(false);
                expect(changes.foo.newValue).to.equal(5);
                expect(area).to.equal('local');
                fired = true;
            });
            await browser.storage.local.set({foo: 5});
            storage_events.drain(1);
            expect(fired).to.equal(true);
        });

        it('delivers events on object update', async function() {
            let fired = false;
            await browser.storage.local.set({foo: 5});
            storage_events.drain(1);

            storage_events.addListener((changes, area) => {
                expect(changes.foo.oldValue).to.equal(5);
                expect(changes.foo.newValue).to.equal(10);
                expect(area).to.equal('local');
                fired = true;
            });
            await browser.storage.local.set({foo: 10});
            storage_events.drain(1);
            expect(fired).to.equal(true);
        });

        it('delivers events on object deletion', async function() {
            let fired = false;
            await browser.storage.local.set({foo: 5});
            storage_events.drain(1);

            storage_events.addListener((changes, area) => {
                expect(changes.foo.oldValue).to.equal(5);
                expect('newValue' in changes.foo).to.equal(false);
                expect(area).to.equal('local');
                fired = true;
            });
            await browser.storage.local.remove('foo');
            storage_events.drain(1);
            expect(fired).to.equal(true);
        });
    });

    describe('behaviors', function() {
        setupMocks();
        let StoredObject = require('./stored-object').default;

        const DEFAULTS = {
            a: 1,
            b: 2,
            foo: 'bar',
            bar: 'foo',
            bool: false,
        };

        beforeEach(function() {
            // Reload the module and reset the mocks for each test so the test
            // has a clean environment with which to start.  This hackery is
            // needed because the mocks have to simulate persistent/global
            // state, after all. :)
            delete require.cache[require.resolve('./stored-object')];
            setupMocks();
            StoredObject = require('./stored-object').default;
        });

        it('retrieves the same object when asked multiple times',
           async function() {
               let o = await StoredObject.get('local', 'foo', DEFAULTS);
               let o2 = await StoredObject.get('local', 'foo', DEFAULTS);
               expect(o).to.equal(o2);
           });

        it('distinguishes between different objects',
           async function() {
               let o = await StoredObject.get('local', 'foo', DEFAULTS);
               let o2 = await StoredObject.get('local', 'bar', DEFAULTS);
               expect(o).to.not.equal(o2);
           });

        it('retrieves the defaults for an object',
           async function() {
               let o = await StoredObject.get('local', 'foo', DEFAULTS);
               expect(o.defaults).to.deep.equal(DEFAULTS);
           });

        it('loads non-existent objects with defaults', async function() {
            let o = await StoredObject.get('local', 'foo', DEFAULTS);
            expect(o).to.deep.equal(DEFAULTS);
        });

        it('loads existent objects with all defaults', async function() {
            await browser.storage.local.set({foo: {}});
            let o = await StoredObject.get('local', 'foo', DEFAULTS);
            expect(o).to.deep.equal(DEFAULTS);
        });

        it('loads existent objects with some defaults overridden',
           async function() {
               const OVERRIDES = {a: 42, bar: 'fred'};
               await browser.storage.local.set({foo: OVERRIDES});
               let o = await StoredObject.get('local', 'foo', DEFAULTS);
               expect(o).to.deep.equal(Object.assign({}, DEFAULTS, OVERRIDES));
           });

        it('updates objects which have been created out-of-band',
           async function() {
               let o = await StoredObject.get('local', 'foo', DEFAULTS);

               await browser.storage.local.set({foo: {a: 42}});
               storage_events.drain(1);

               expect(o).to.deep.equal(Object.assign({}, DEFAULTS, {a: 42}));
           });

        it('updates objects which have been updated out-of-band',
           async function() {
               await browser.storage.local.set({foo: {a: 42}});
               storage_events.drain(1);

               let o = await StoredObject.get('local', 'foo', DEFAULTS);

               await browser.storage.local.set({foo: {a: 17}});
               storage_events.drain(1);

               expect(o).to.deep.equal(Object.assign({}, DEFAULTS, {a: 17}));
           });

        it('updates objects which have been deleted out-of-band',
           async function() {
               await browser.storage.local.set({foo: {a: 42}});
               storage_events.drain(1);

               let o = await StoredObject.get('local', 'foo', DEFAULTS);

               await browser.storage.local.remove('foo');
               storage_events.drain(1);

               expect(o).to.deep.equal(Object.assign({}, DEFAULTS));
           });

        it('sets values which are not the default', async function() {
            const OVERRIDES = {a: 42, bar: 'fred'};
            let o = await StoredObject.get('local', 'foo', DEFAULTS);
            expect(o).to.deep.equal(DEFAULTS);

            await o.set(OVERRIDES);
            storage_events.drain(1);

            expect(await browser.storage.local.get('foo'))
                .to.deep.equal({foo: OVERRIDES});
            expect(o).to.deep.equal(Object.assign({}, DEFAULTS, OVERRIDES));
        });

        it('sets non-default values to other non-default values',
           async function() {
               const OVERRIDES = {a: 42, bar: 'fred'};
               await browser.storage.local.set({foo: OVERRIDES});
               storage_events.drain(1);

               let o = await StoredObject.get('local', 'foo', DEFAULTS);

               await o.set({a: 17});
               storage_events.drain(1);

               expect(await browser.storage.local.get('foo'))
                   .to.deep.equal({foo: Object.assign({}, OVERRIDES, {a: 17})});
               expect(o).to.deep.equal(Object.assign({}, DEFAULTS, OVERRIDES,
                                                     {a: 17}));
           });

        it('resets non-default values to the default',
           async function() {
               const OVERRIDES = {a: 42, bar: 'fred'};
               await browser.storage.local.set({foo: OVERRIDES});
               storage_events.drain(1);

               let o = await StoredObject.get('local', 'foo', DEFAULTS);

               await o.set({a: 1});
               storage_events.drain(1);

               expect(await browser.storage.local.get('foo'))
                   .to.deep.equal({foo: {bar: 'fred'}});
               expect(o)
                   .to.deep.equal(Object.assign({}, DEFAULTS, {bar: 'fred'}));
        });

        it('deletes non-existent objects from the store', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.delete();
            storage_events.drain(1);

            expect(await browser.storage.local.get()).to.deep.equal({});
            expect(o).to.deep.equal(DEFAULTS);
        });

        it('deletes existing objects from the store', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.set({a: 2});
            await o.delete();
            storage_events.drain(2);

            expect(await browser.storage.local.get()).to.deep.equal({});
            expect(o).to.deep.equal(DEFAULTS);
        });

        it('forgets never-created objects', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.delete();
            storage_events.drain(1);

            let o2 = await StoredObject.get('sync', 'foo', DEFAULTS);

            expect(o).to.not.equal(o2);
        });

        it('forgets deleted objects', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.set({a: 5});
            await o.delete();
            storage_events.drain(2);

            let o2 = await StoredObject.get('sync', 'foo', DEFAULTS);

            expect(o).to.not.equal(o2);
        });

        it('resurrects deleted objects when modified', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.delete();
            storage_events.drain(1);

            await o.set({a: 2});
            storage_events.drain(1);

            let o2 = await StoredObject.get('sync', 'foo', DEFAULTS);

            expect(o).to.equal(o2);
        });

        it('drops keys it does not recognize on save', async function() {
            const DATA = {foo: {asdf: 'qwer'}};
            await browser.storage.sync.set(DATA);
            await storage_events.drain(1);

            let o = await StoredObject.get('sync', 'foo', DEFAULTS);
            expect(o).to.deep.equal(DEFAULTS);
            expect(await browser.storage.sync.get()).to.deep.equal(DATA);

            await o.set({a: 1});
            await storage_events.drain(1);

            expect(await browser.storage.sync.get()).to.deep.equal({foo: {}});
            expect(o).to.deep.equal(DEFAULTS);
        });
    });
});
