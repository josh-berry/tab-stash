import {expect} from 'chai';

import * as events from './mock/events';
import mock_runtime from './mock/browser-runtime';

import {Message, UpdateMessage, ExpiredMessage} from './cache-proto';
import {Cache} from './cache-client';

class MockCacheService {
    ports = new Set<browser.runtime.Port>();
    entries = new Map<string, string>();

    constructor() {
        browser.runtime.onConnect.addListener(port => {
            this.ports.add(port);

            port.onDisconnect.addListener(p => {
                this.ports.delete(port);
            });

            port.onMessage.addListener(msg => {
                const m = <Message<string>>msg;
                switch (m.type) {
                    case 'update': {
                        for (const ent of m.entries) {
                            this.entries.set(ent.key, ent.value);
                        }
                        break;
                    }
                    case 'fetch': {
                        const entries = [];
                        for (const key of m.keys) {
                            let ent = this.entries.get(key);
                            if (! ent) continue;
                            entries.push({key, value: ent});
                        }
                        port.postMessage(<UpdateMessage<string>>{
                            type: 'update',
                            entries,
                        });
                        break;
                    }
                    default:
                        expect(m, `unknown message`).to.be.undefined;
                        break;
                }
            });
        });
    }

    set(entries: {key: string, value: string}[]) {
        for (const ent of entries) this.entries.set(ent.key, ent.value);
        const msg: UpdateMessage<string> = {type: 'update', entries};
        for (const p of this.ports) p.postMessage(msg);
    }

    evict(keys: string[]) {
        for (const k of keys) {
            expect(this.entries.has(k)).to.be.true;
            this.entries.delete(k);
        }
        const msg: ExpiredMessage = {type: 'expired', keys};
        for (const p of this.ports) p.postMessage(msg);
    }
}

function reload_cache(): Cache<string> {
    delete require.cache[require.resolve('./cache-client')];
    return require('./cache-client').Cache.open('test');
}

describe('cache-client', function() {
    beforeEach(() => {
        mock_runtime.reset();
    });
    afterEach(events.expect_empty);

    describe('local caching when service is down', function() {
        let cache: Cache<string>;
        beforeEach(async () => {
            cache = reload_cache();
            await events.drain(1);
        });

        it('caches content', async function() {
            expect(cache.get('foo').value).to.be.undefined;
            cache.set('foo', 'bar');
            expect(cache.get('foo').value).to.equal('bar');
            await events.drain(2);
        });

        it('returns the same object when get() is called twice',
           async function() {
               expect(cache.get('foo')).to.not.be.undefined;
               expect(cache.get('foo')).to.equal(cache.get('foo'));
               await events.drain(1);
           });

        it('updates objects returned via get() previously', async function() {
            const obj = cache.get('foo');
            expect(obj.value).to.be.undefined;

            cache.set('foo', 'bar');
            await events.drain(2);

            expect(obj.value).to.equal('bar');
        });
    });

    describe('caching via the service', function() {
        let service: MockCacheService;
        let cache: Cache<string>;

        beforeEach(async () => {
            service = new MockCacheService();
            cache = reload_cache();
            await events.drain(1); // connections
        });

        it('caches content with the service', async function() {
            cache.set('foo', 'bar');
            await events.drain(1);
            expect(service.entries.get('foo')).to.equal('bar');
        });

        it("loads content it doesn't know about from the service",
           async function() {
               service.entries.set('foo', 'bar');

               let obj = cache.get('foo');
               expect(obj.value).to.be.undefined;

               await events.drain(2); // fetch/response pair
               expect(obj.value).to.equal('bar');
           });

        it("ignores updates from the service it's not interested in",
           async function() {
               service.set([{key: 'foo', value: 'bar'}]);
               await events.drain(1); // broadcast from service

               expect(cache.get('foo').value).to.be.undefined;
               await events.drain(2); // fetch/update pair
           });

        it("applies updates from the service to previously-requested objects",
           async function() {
               service.entries.set('foo', 'bar');
               service.entries.set('bar', 'baz');

               // Request objects either by updating them or by fetching them
               cache.get('foo');
               cache.get('bar');
               await events.drain(2); // fetch/response

               expect(cache.get('foo').value).to.equal('bar');
               expect(cache.get('bar').value).to.equal('baz');

               // Apply an update
               service.set([{key: 'foo', value: 'extra'},
                            {key: 'bar', value: 'crunchy'}]);
               await events.drain(1); // broadcast from service

               expect(cache.get('foo').value).to.equal('extra');
               expect(cache.get('bar').value).to.equal('crunchy');
           });

        it("applies updates from the service to previously-set objects",
           async function() {
               cache.set('foo', 'bar');
               cache.set('bar', 'baz');
               await events.drain(1); // update

               expect(cache.get('foo').value).to.equal('bar');
               expect(cache.get('bar').value).to.equal('baz');

               service.set([{key: 'foo', value: 'extra'},
                            {key: 'bar', value: 'crunchy'}]);
               await events.drain(1); // broadcast from service

               expect(cache.get('foo').value).to.equal('extra');
               expect(cache.get('bar').value).to.equal('crunchy');
           });

        it('discards content deleted from the service', async function() {
            cache.set('foo', 'bar');
            cache.set('bar', 'baz');
            await events.drain(1); // update

            expect(cache.get('foo').value).to.equal('bar');
            expect(cache.get('bar').value).to.equal('baz');

            service.evict(['foo', 'bar']);

            await events.drain(1); // eviction
            expect(cache.get('foo').value).to.be.undefined;
            expect(cache.get('bar').value).to.be.undefined;
        });
    });
});
