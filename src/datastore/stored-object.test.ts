import {expect} from 'chai';
import * as events from '../mock/events';
import storage_mock from '../mock/browser-storage';
import {aBoolean, aNumber, aString, StorableDef, StoredObject} from './stored-object';

describe('stored-object', function() {
    beforeEach(function() {
        storage_mock.reset();
    });
    afterEach(events.expect_empty);

    describe('mocks', function() {
        it('stores and retrieves single values', async function() {
            const obj = {foo: 'bar'};
            await browser.storage.local.set(obj);
            expect(await browser.storage.local.get('foo')).to.deep.equal(obj);
            await events.drain(1);
        });

        it('stores and retrieves multiple values', async function() {
            const obj = {
                foo: 'bar',
                obj: {a: 1, b: 2},
            };
            await browser.storage.local.set(obj);
            expect(await browser.storage.local.get(['foo', 'obj']))
                .to.deep.equal(obj);
            await events.drain(1);
        });

        it('deletes single values', async function() {
            await browser.storage.local.set({foo: 'bar'});
            await browser.storage.local.remove('foo');
            expect(await browser.storage.local.get()).to.deep.equal({});
            await events.drain(2);
        });

        it('deletes multiple values', async function() {
            await browser.storage.local.set({foo: 'bar', bar: 'baz'});
            await browser.storage.local.remove(['foo', 'bar']);
            expect(await browser.storage.local.get()).to.deep.equal({});
            await events.drain(2);
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
            await events.drain(1);
            expect(fired).to.equal(true);
        });

        it('delivers events on object update', async function() {
            let fired = false;
            await browser.storage.local.set({foo: 5});
            await events.drain(1);

            browser.storage.onChanged.addListener((changes, area) => {
                expect(changes.foo.oldValue).to.equal(5);
                expect(changes.foo.newValue).to.equal(10);
                expect(area).to.equal('local');
                fired = true;
            });
            await browser.storage.local.set({foo: 10});
            await events.drain(1);
            expect(fired).to.equal(true);
        });

        it('delivers events on object deletion', async function() {
            let fired = false;
            await browser.storage.local.set({foo: 5});
            await events.drain(1);

            browser.storage.onChanged.addListener((changes, area) => {
                expect(changes.foo.oldValue).to.equal(5);
                expect('newValue' in changes.foo).to.equal(false);
                expect(area).to.equal('local');
                fired = true;
            });
            await browser.storage.local.remove('foo');
            await events.drain(1);
            expect(fired).to.equal(true);
        });
    });

    describe('behaviors', function() {
        storage_mock.reset();
        let StoredObject = require('./stored-object').default;

        const DEF = {
            a: {default: 1, is: aNumber},
            b: {default: 2, is: aNumber},
            foo: {default: 'bar', is: aString},
            bar: {default: 'foo', is: aString},
            bool: {default: false, is: aBoolean},
        };

        const defaults = <D extends StorableDef>(def: D) => Object.keys(def)
            .reduce((obj: StoredObject<D>, k: keyof D) => {
                (<any>obj)[k] = def[k].default;
                return obj;
            }, {} as StoredObject<D>);

        beforeEach(function() {
            // Reload the module and reset the mocks for each test so the test
            // has a clean environment with which to start.  This hackery is
            // needed because the mocks have to simulate persistent/global
            // state, after all. :)
            delete require.cache[require.resolve('./stored-object')];
            storage_mock.reset();
            StoredObject = require('./stored-object').default;
        });

        it('retrieves the same object when asked multiple times',
           async function() {
               const o = await StoredObject.local('foo', DEF);
               const o2 = await StoredObject.local('foo', DEF);
               expect(o).to.equal(o2);
           });

        it('distinguishes between different objects',
           async function() {
               const o = await StoredObject.local('foo', DEF);
               const o2 = await StoredObject.local('bar', DEF);
               expect(o).to.not.equal(o2);
           });

        it('loads non-existent objects with defaults', async function() {
            const o = await StoredObject.local('foo', DEF);
            expect(o).to.deep.include(defaults(DEF));
        });

        it('loads existent objects with all defaults', async function() {
            await browser.storage.local.set({foo: {}});
            const o = await StoredObject.local('foo', DEF);
            expect(o).to.deep.include(defaults(DEF));
            await events.drain(1);
        });

        it('loads existent objects with some defaults overridden',
           async function() {
               const OVERRIDES = {a: 42, bar: 'fred'};

               await browser.storage.local.set({foo: OVERRIDES});
               await events.drain(1);

               const o = await StoredObject.local('foo', DEF);
               expect(o).to.deep.include(Object.assign({}, defaults(DEF), OVERRIDES));
           });

        it('updates objects which have been created out-of-band',
           async function() {
               const o = await StoredObject.local('foo', DEF);

               await browser.storage.local.set({foo: {a: 42}});
               await events.drain(1);

               expect(o).to.deep.include(Object.assign({}, defaults(DEF), {a: 42}));
           });

        it('updates objects which have been updated out-of-band',
           async function() {
               await browser.storage.local.set({foo: {a: 42}});
               await events.drain(1);

               const o = await StoredObject.local('foo', DEF);

               await browser.storage.local.set({foo: {a: 17}});
               await events.drain(1);

               expect(o).to.deep.include(Object.assign({}, defaults(DEF), {a: 17}));
           });

        it('updates objects which have been deleted out-of-band',
           async function() {
               await browser.storage.local.set({foo: {a: 42}});
               await events.drain(1);

               const o = await StoredObject.local('foo', DEF);

               await browser.storage.local.remove('foo');
               await events.drain(1);

               expect(o).to.deep.include(Object.assign({}, defaults(DEF)));
           });

        it('sets values which are not the default', async function() {
            const OVERRIDES = {a: 42, bar: 'fred'};
            const o = await StoredObject.local('foo', DEF);
            expect(o).to.deep.include(defaults(DEF));

            await o.set(OVERRIDES);
            await events.drain(1);

            expect(await browser.storage.local.get('foo'))
                .to.deep.equal({foo: OVERRIDES});
            expect(o).to.deep.include(Object.assign({}, defaults(DEF), OVERRIDES));
        });

        it('sets non-default values to other non-default values',
           async function() {
               const OVERRIDES = {a: 42, bar: 'fred'};
               await browser.storage.local.set({foo: OVERRIDES});
               await events.drain(1);

               const o = await StoredObject.local('foo', DEF);

               await o.set({a: 17});
               await events.drain(1);

               expect(await browser.storage.local.get('foo'))
                   .to.deep.equal({foo: Object.assign({}, OVERRIDES, {a: 17})});
               expect(o).to.deep.include(
                   Object.assign({}, defaults(DEF), OVERRIDES, {a: 17}));
           });

        it('converts loaded values which are the wrong type', async() => {
            const OVERRIDES = {a: '42'};
            await browser.storage.local.set({foo: OVERRIDES});
            await events.drain(1);

            const o = await StoredObject.local('foo', DEF);
            expect(o).to.deep.include({a: 42});
        });

        it('converts saved values which are the wrong type', async() => {
            const OVERRIDES = {a: 42};
            await browser.storage.local.set({foo: OVERRIDES});
            await events.drain(1);

            const o = await StoredObject.local('foo', DEF);

            await o.set({a: '17'});
            await events.drain(1);

            expect(await browser.storage.local.get('foo'))
                .to.deep.equal({foo: {a: 17}});
        });

        it('resets non-default values to the default',
           async function() {
               const OVERRIDES = {a: 42, bar: 'fred'};
               await browser.storage.local.set({foo: OVERRIDES});
               await events.drain(1);

               const o = await StoredObject.local('foo', DEF);

               await o.set({a: 1});
               await events.drain(1);

               expect(await browser.storage.local.get('foo'))
                   .to.deep.equal({foo: {bar: 'fred'}});
               expect(o)
                   .to.deep.include(Object.assign({}, defaults(DEF), {bar: 'fred'}));
        });

        it('resets non-default values to the default after type-casting', async () => {
            const OVERRIDES = {a: 42, bar: 'fred'};
            await browser.storage.local.set({foo: OVERRIDES});
            await events.drain(1);

            const o = await StoredObject.local('foo', DEF);

            await o.set({a: "1"});
            await events.drain(1);

            expect(await browser.storage.local.get('foo'))
                .to.deep.equal({foo: {bar: 'fred'}});
            expect(o)
                .to.deep.include(Object.assign({}, defaults(DEF), {bar: 'fred'}));
        });

        it('deletes non-existent objects from the store', async function() {
            const o = await StoredObject.sync('foo', DEF);

            await o.delete();
            await events.drain(1);

            expect(await browser.storage.local.get()).to.deep.equal({});
            expect(o).to.deep.include(defaults(DEF));
        });

        it('deletes existing objects from the store', async function() {
            const o = await StoredObject.sync('foo', DEF);

            await o.set({a: 2});
            await o.delete();
            await events.drain(2);

            expect(await browser.storage.local.get()).to.deep.equal({});
            expect(o).to.deep.include(defaults(DEF));
        });

        it('forgets never-created objects', async function() {
            const o = await StoredObject.sync('foo', DEF);

            await o.delete();
            await events.drain(1);

            const o2 = await StoredObject.sync('foo', DEF);

            expect(o).to.not.equal(o2);
        });

        it('forgets deleted objects', async function() {
            const o = await StoredObject.sync('foo', DEF);

            await o.set({a: 5});
            await o.delete();
            await events.drain(2);

            const o2 = await StoredObject.sync('foo', DEF);

            expect(o).to.not.equal(o2);
        });

        it('resurrects deleted objects when modified', async function() {
            const o = await StoredObject.sync('foo', DEF);

            await o.delete();
            await events.drain(1);

            await o.set({a: 2});
            await events.drain(1);

            const o2 = await StoredObject.sync('foo', DEF);

            expect(o).to.equal(o2);
        });

        it('drops keys it does not recognize on save', async function() {
            const DATA = {foo: {asdf: 'qwer'}};
            await browser.storage.sync.set(DATA);
            await events.drain(1);

            const o = await StoredObject.sync('foo', DEF);
            expect(o).to.deep.include(defaults(DEF));
            expect(await browser.storage.sync.get()).to.deep.equal(DATA);

            await o.set({a: 1});
            await events.drain(1);

            expect(await browser.storage.sync.get()).to.deep.equal({foo: {}});
            expect(o).to.deep.include(defaults(DEF));
        });
    });
});
