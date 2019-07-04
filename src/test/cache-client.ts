import {expect} from 'chai';

import mock_runtime from './mock/browser-runtime';

import {Message, EntryMessage, ExpiringMessage} from '../cache-proto';

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
                    case 'entry': {
                        this.entries.set(m.key, m.value);
                        break;
                    }
                    case 'fetch': {
                        let ent = this.entries.get(m.key);
                        if (! ent) return;
                        port.postMessage(<EntryMessage<string>>{
                            type: 'entry',
                            key: m.key,
                            value: ent,
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

    set(key: string, value: string) {
        this.entries.set(key, value);
        for (const p of this.ports) {
            p.postMessage(<EntryMessage<string>>{type: 'entry', key, value});
        }
    }

    evict(key: string) {
        expect(this.entries.has(key)).to.be.true;
        this.entries.delete(key);
        for (const p of this.ports) {
            p.postMessage(<ExpiringMessage>{type: 'expiring', key});
        }
    }
}

function reload_cache() {
    delete require.cache[require.resolve('../cache-client')];
    return require('../cache-client').Cache.open('test');
}

async function drain() {
    while (await mock_runtime.drain() > 0);
}

describe('cache-client', function() {
    beforeEach(() => {
        mock_runtime.reset();
    });

    describe('local caching when service is down', function() {
        let cache = reload_cache();
        beforeEach(() => {cache = reload_cache()});

        it('caches content', function() {
            expect(cache.get('foo').value).to.be.undefined;
            cache.set('foo', 'bar');
            expect(cache.get('foo').value).to.equal('bar');
        });

        it('returns the same object when get() is called twice', function() {
            expect(cache.get('foo')).to.not.be.undefined;
            expect(cache.get('foo')).to.equal(cache.get('foo'));
        });

        it('updates objects returned via get() previously', function() {
            const obj = cache.get('foo');
            expect(obj.value).to.be.undefined;
            cache.set('foo', 'bar');
            expect(obj.value).to.equal('bar');
        });
    });

    describe('caching via the service', function() {
        let service = new MockCacheService();
        let cache1 = reload_cache();
        let cache2 = reload_cache();

        beforeEach(() => {
            service = new MockCacheService();
            cache1 = reload_cache();
            cache2 = reload_cache();
        });

        it('caches content with the service', async function() {
            cache1.set('foo', 'bar');
            await drain();
            expect(service.entries.get('foo')).to.equal('bar');
        });

        it("loads content it doesn't know about from the service",
           async function() {
               service.set('foo', 'bar');

               let obj = cache1.get('foo');
               expect(obj.value).to.be.undefined;

               await drain();
               expect(obj.value).to.equal('bar');
           });

        it('forwards cached content to other caches (eventually)',
           async function() {
               cache1.set('foo', 'bar');

               await drain();
               expect(cache2.get('foo').value).to.be.undefined;

               await drain();
               expect(cache2.get('foo').value).to.equal('bar');
           });

        it('discards content deleted from the service', async function() {
            cache1.set('foo', 'bar');

            await drain();
            expect(cache2.get('foo').value).to.be.undefined;

            await drain();
            expect(cache1.get('foo').value).to.equal('bar');
            expect(cache2.get('foo').value).to.equal('bar');

            service.evict('foo');

            await drain();
            expect(cache1.get('foo').value).to.be.undefined;
            expect(cache2.get('foo').value).to.be.undefined;
        });
    });
});
