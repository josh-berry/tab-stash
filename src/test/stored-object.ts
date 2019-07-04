import {expect} from 'chai';
import storage_mock from './mock/browser-storage';

async function drain(): Promise<number> {
    let count = 0;
    while (true) {
        const c = await storage_mock.events.drain();
        count += c;
        if (c == 0) break;
    }
    return count;
}

describe('stored-object', function() {
    beforeEach(function() {
        storage_mock.reset();
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
            browser.storage.onChanged.addListener((changes, area) => {
                expect('oldValue' in changes.foo).to.equal(false);
                expect(changes.foo.newValue).to.equal(5);
                expect(area).to.equal('local');
                fired = true;
            });
            await browser.storage.local.set({foo: 5});
            expect(await drain()).to.equal(1);
            expect(fired).to.equal(true);
        });

        it('delivers events on object update', async function() {
            let fired = false;
            await browser.storage.local.set({foo: 5});
            expect(await drain()).to.equal(1);

            browser.storage.onChanged.addListener((changes, area) => {
                expect(changes.foo.oldValue).to.equal(5);
                expect(changes.foo.newValue).to.equal(10);
                expect(area).to.equal('local');
                fired = true;
            });
            await browser.storage.local.set({foo: 10});
            expect(await drain()).to.equal(1);
            expect(fired).to.equal(true);
        });

        it('delivers events on object deletion', async function() {
            let fired = false;
            await browser.storage.local.set({foo: 5});
            expect(await drain()).to.equal(1);

            browser.storage.onChanged.addListener((changes, area) => {
                expect(changes.foo.oldValue).to.equal(5);
                expect('newValue' in changes.foo).to.equal(false);
                expect(area).to.equal('local');
                fired = true;
            });
            await browser.storage.local.remove('foo');
            expect(await drain()).to.equal(1);
            expect(fired).to.equal(true);
        });
    });

    describe('behaviors', function() {
        storage_mock.reset();
        let StoredObject = require('../stored-object').default;

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
            delete require.cache[require.resolve('../stored-object')];
            storage_mock.reset();
            StoredObject = require('../stored-object').default;
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
               expect(await drain()).to.equal(1);

               expect(o).to.deep.equal(Object.assign({}, DEFAULTS, {a: 42}));
           });

        it('updates objects which have been updated out-of-band',
           async function() {
               await browser.storage.local.set({foo: {a: 42}});
               expect(await drain()).to.equal(1);

               let o = await StoredObject.get('local', 'foo', DEFAULTS);

               await browser.storage.local.set({foo: {a: 17}});
               expect(await drain()).to.equal(1);

               expect(o).to.deep.equal(Object.assign({}, DEFAULTS, {a: 17}));
           });

        it('updates objects which have been deleted out-of-band',
           async function() {
               await browser.storage.local.set({foo: {a: 42}});
               expect(await drain()).to.equal(1);

               let o = await StoredObject.get('local', 'foo', DEFAULTS);

               await browser.storage.local.remove('foo');
               expect(await drain()).to.equal(1);

               expect(o).to.deep.equal(Object.assign({}, DEFAULTS));
           });

        it('sets values which are not the default', async function() {
            const OVERRIDES = {a: 42, bar: 'fred'};
            let o = await StoredObject.get('local', 'foo', DEFAULTS);
            expect(o).to.deep.equal(DEFAULTS);

            await o.set(OVERRIDES);
            expect(await drain()).to.equal(1);

            expect(await browser.storage.local.get('foo'))
                .to.deep.equal({foo: OVERRIDES});
            expect(o).to.deep.equal(Object.assign({}, DEFAULTS, OVERRIDES));
        });

        it('sets non-default values to other non-default values',
           async function() {
               const OVERRIDES = {a: 42, bar: 'fred'};
               await browser.storage.local.set({foo: OVERRIDES});
               expect(await drain()).to.equal(1);

               let o = await StoredObject.get('local', 'foo', DEFAULTS);

               await o.set({a: 17});
               expect(await drain()).to.equal(1);

               expect(await browser.storage.local.get('foo'))
                   .to.deep.equal({foo: Object.assign({}, OVERRIDES, {a: 17})});
               expect(o).to.deep.equal(Object.assign({}, DEFAULTS, OVERRIDES,
                                                     {a: 17}));
           });

        it('resets non-default values to the default',
           async function() {
               const OVERRIDES = {a: 42, bar: 'fred'};
               await browser.storage.local.set({foo: OVERRIDES});
               expect(await drain()).to.equal(1);

               let o = await StoredObject.get('local', 'foo', DEFAULTS);

               await o.set({a: 1});
               expect(await drain()).to.equal(1);

               expect(await browser.storage.local.get('foo'))
                   .to.deep.equal({foo: {bar: 'fred'}});
               expect(o)
                   .to.deep.equal(Object.assign({}, DEFAULTS, {bar: 'fred'}));
        });

        it('deletes non-existent objects from the store', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.delete();
            expect(await drain()).to.equal(1);

            expect(await browser.storage.local.get()).to.deep.equal({});
            expect(o).to.deep.equal(DEFAULTS);
        });

        it('deletes existing objects from the store', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.set({a: 2});
            await o.delete();
            expect(await drain()).to.equal(2);

            expect(await browser.storage.local.get()).to.deep.equal({});
            expect(o).to.deep.equal(DEFAULTS);
        });

        it('forgets never-created objects', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.delete();
            expect(await drain()).to.equal(1);

            let o2 = await StoredObject.get('sync', 'foo', DEFAULTS);

            expect(o).to.not.equal(o2);
        });

        it('forgets deleted objects', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.set({a: 5});
            await o.delete();
            expect(await drain()).to.equal(2);

            let o2 = await StoredObject.get('sync', 'foo', DEFAULTS);

            expect(o).to.not.equal(o2);
        });

        it('resurrects deleted objects when modified', async function() {
            let o = await StoredObject.get('sync', 'foo', DEFAULTS);

            await o.delete();
            expect(await drain()).to.equal(1);

            await o.set({a: 2});
            expect(await drain()).to.equal(1);

            let o2 = await StoredObject.get('sync', 'foo', DEFAULTS);

            expect(o).to.equal(o2);
        });

        it('drops keys it does not recognize on save', async function() {
            const DATA = {foo: {asdf: 'qwer'}};
            await browser.storage.sync.set(DATA);
            expect(await drain()).to.equal(1);

            let o = await StoredObject.get('sync', 'foo', DEFAULTS);
            expect(o).to.deep.equal(DEFAULTS);
            expect(await browser.storage.sync.get()).to.deep.equal(DATA);

            await o.set({a: 1});
            expect(await drain()).to.equal(1);

            expect(await browser.storage.sync.get()).to.deep.equal({foo: {}});
            expect(o).to.deep.equal(DEFAULTS);
        });
    });
});
