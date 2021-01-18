import {expect} from 'chai';
import {browser, Runtime} from 'webextension-polyfill-ts';

import * as events from '../../mock/events';
import '../../mock/browser-runtime';

import * as M from '.';
import * as Live from './live';

type Port = Runtime.Port;

describe('util/nanoservice', function() {
    describe('NanoPort', function() {
        async function portpair<S extends M.Send, R extends M.Send>(
            name: string
        ): Promise<[M.NanoPort<S, R>, Port]> {
            const [port, [svcport]] = await events.waitOne(
                async (): Promise<M.NanoPort<S, R>> => M.connect('test'),
                browser.runtime.onConnect);

            expect(port).to.not.be.undefined;
            expect(svcport.name).to.equal('test');
            return [port, svcport];
        }

        it('connects and disconnects', async function() {
            const [port, svcport] = await portpair('test');
            await events.waitOne(
                async() => port.disconnect(),
                svcport.onDisconnect);
        });

        it('raises disconnection events', async function() {
            const [client, svc] = await portpair('test');
            let died = false;
            client.onDisconnect = () => {died = true};
            svc.disconnect();
            await events.drain(1);
            expect(died).to.be.true;
        });

        it('sends notifications', async function() {
            const [client, svc] = await portpair('test');

            const [, [val]] = await events.waitOne(
                async() => client.notify(42),
                svc.onMessage);

            expect(val).to.deep.equal({notify: 42});
        });

        it('receives notifications', async function() {
            const [client, svc] = await portpair('test');
            let res = undefined;

            client.onNotify = v => {res = v};
            svc.postMessage({notify: 37});
            await events.drain(1);
            expect(res).to.equal(37);
        });

        it('handles notifications as requests if no onNotify is set', async function() {
            const [client, svc] = await portpair('test');
            let res = undefined;

            client.onRequest = async(v) => { res = v; return null; };
            svc.postMessage({notify: 26});
            await events.drain(1);
            expect(res).to.equal(26);
        });

        it('sends requests and receives responses', async function() {
            const [client, svc] = await portpair('test');
            const [res, [req]] = await events.waitOne(
                async() => client.request("meow?"),
                svc.onMessage,
                (req: any) => svc.postMessage({tag: req.tag, response: 'meow!'}),
                2);

            expect(req.tag).to.be.a('string');
            expect(req.request).to.equal('meow?');
            expect(res).to.equal('meow!');
        });

        it('receives requests and sends responses', async function() {
            const [client, svc] = await portpair<number, number>('test');
            let received = false;

            client.onRequest = async(v) => {
                received = true;
                return v + 24;
            };

            svc.postMessage({tag: 'hi', request: 8});
            await events.drain(1);
            expect(received).to.be.true;

            await events.waitOne(async() => undefined, svc.onMessage,
                res => expect(res).to.deep.equal({tag: 'hi', response: 32}));
        });

        it('sends requests and throws errors', async function () {
            const [client, svc] = await portpair('test');

            try {
                await events.waitOne(
                    async() => client.request(42),
                    svc.onMessage,
                    (req: any) => svc.postMessage({tag: req.tag, error: {
                        name: 'Oops',
                        message: 'oops',
                        data: {
                            value: 42,
                            fn: /* istanbul ignore next */ () => {},
                        },
                    }}), 2);

                // istanbul ignore next
                expect(true).to.be.false;

            } catch (e) {
                expect(e).to.be.instanceOf(M.RemoteNanoError);
                expect(e.name).to.equal('Oops');
                expect(e.message).to.equal('oops');
                expect(e.data).to.deep.equal({value: 42});
                expect(e.stack).to.be.a('string');
                expect(e.remote).to.deep.include({
                    name: 'Oops',
                    message: 'oops',
                    data: {value: 42},
                });
            }
        });

        it('receives requests and returns errors', async function() {
            const [client, svc] = await portpair('test');
            let received = false;

            client.onRequest = async(v) => {
                received = true;
                throw new Error("oops");
            };

            svc.postMessage({tag: 'what', request: 0});
            await events.drain(1);
            expect(received).to.be.true;

            await events.waitOne(async() => undefined, svc.onMessage,
                (res: any) => {
                    expect(res.tag).to.equal('what');
                    expect(res.error).to.deep.include({
                        name: 'Error',
                        message: 'oops',
                        data: {},
                    });
                    expect(res.error.stack).to.not.be.undefined;
                });
        });

        describe('correctly throws weird values', () => {
            const check = (throws: any, returns: any) => async() => {
                const [client, svc] = await portpair('test');
                client.onRequest = async(v) => { throw throws; };

                svc.postMessage({tag: 'what', request: 0});
                await events.drain(1);

                await events.waitOne(async() => undefined, svc.onMessage,
                    (res: any) => {
                        expect(res).to.deep.include({tag: 'what'});
                        expect(res.error).to.deep.include(returns);
                    },
                );
            };

            it('...numbers', check(42, {name: '', data: 42}));
            it('...strings', check('oops', {name: '', data: 'oops'}));
            it('...functions', check(
                /* istanbul ignore next */ () => {},
                {name: 'Function'},
            ));
            it('...objects', check(
                {oops: 'object'},
                {name: 'Object', data: {oops: 'object'}},
            ));
            it('...objects with functions', check(
                {oops: 'o', fn: /* istanbul ignore next */ () => {}},
                {name: 'Object'},
            ));
        });

        it('sends multiple requests at once', async function() {
            const [client, svc] = await portpair('test');

            const seenTags = new Set();
            svc.onMessage.addListener((ev: any) => {
                expect(ev.tag).to.be.a('string');
                expect(seenTags.has(ev.tag)).to.be.false;
                seenTags.add(ev.tag);
                svc.postMessage({tag: ev.tag, response: ev.request});
            });
            const a = client.request(1);
            const b = client.request(2);
            await events.drain(4);
            expect(await a).to.equal(1);
            expect(await b).to.equal(2);
        });

        it('receives multiple requests at once', async function() {
            const [client, svc] = await portpair<number, number>('test');

            let count = 0;
            client.onRequest = async(req) => req + 4;
            svc.postMessage({tag: 'a', request: 10});
            svc.postMessage({tag: 'b', request: 20});
            svc.onMessage.addListener((msg: any) => {
                switch (count) {
                    case 0:
                        expect(msg.tag).to.equal('a');
                        expect(msg.response).to.equal(14);
                        break;
                    case 1:
                        expect(msg.tag).to.equal('b');
                        expect(msg.response).to.equal(24);
                        break;
                    /* istanbul ignore next */
                    default: expect(false).to.be.true;
                }
                ++count;
            });
            await events.drain(4);
            expect(count).to.equal(2);
        });

        it('times out if no response is received to a request', async function() {
            const [client, ] = await portpair('test');
            const p = client.request('void', {timeout_ms: 20});
            await events.drain(1);
            try {
                await p;
            } catch (e) {
                expect(e).to.be.instanceOf(M.NanoTimeoutError);
                expect(e.name).to.equal('NanoTimeoutError');
                expect(e.request).to.equal('void');
            }
        });

        it('drops notifications to disconnected ports', async function() {
            const [client, svc] = await portpair('test');
            svc.disconnect();
            await events.drain(1);
            client.notify(42);
        });

        it('throws when requesting from a disconnected port', async function() {
            const [client, svc] = await portpair('test');
            svc.disconnect();
            await events.drain(1);
            try {
                client.notify(42);
                // istanbul ignore next
                expect(false).to.be.true;
            } catch(e) {
                expect(e).to.be.instanceOf(Error);
                expect(e).to.not.be.instanceOf(M.RemoteNanoError);
            }
        });

        it('drops malformed messages', async function() {
            const [client, svc] = await portpair('test');
            let called = false;
            client.onRequest = /* istanbul ignore next */ async() => {
                called = true;
                return null;
            };

            svc.postMessage(42);
            svc.postMessage('hi');
            svc.postMessage(['r', 'u', 'there']);
            svc.postMessage({status: 'online'});
            svc.postMessage({tag: '42', status: 'online'});

            await events.drain(5);
            expect(called).to.be.false;
        });

        it('drops responses to requessts it didn\'t send', async() => {
            const [client, svc] = await portpair('test');
            let called = false;
            client.onRequest = /* istanbul ignore next */ async() => {
                called = true;
                return null;
            };

            svc.postMessage({tag: '42', response: 'online'});
            svc.postMessage({tag: '42', error: 'failed'});

            await events.drain(2);
            expect(called).to.be.false;
        });

        it('drops replies to disconnected ports', async function() {
            const [client, svc] = await portpair('test');
            const dest = new Live.Port('testport', svc);
            const p = client.request(42);
            dest.disconnect();
            await events.drain(2);
            try {
                await p;
                // istanbul ignore next
                expect(false).to.be.true;
            } catch (e) {
                expect(e).to.be.instanceOf(Error);
                expect(e).to.not.be.instanceOf(M.RemoteNanoError);
            }
        });

        it('rejects pending requests when disconnected', async function() {
            const [client, ] = await portpair('test');
            const p = client.request(42)
                .then(/* istanbul ignore next */ () => {
                    throw new Error("Unreachable code");
                }).catch(e => {
                    expect(e).to.be.instanceOf(Error);
                    expect(e).to.not.be.instanceOf(M.RemoteNanoError);
                });
            client.disconnect(); // <== key difference from the above test
            await events.drain(2);
            await p;
        });
    });

    describe('NanoService', function() {
        beforeEach(() => M.registry.reset_testonly());

        it('ignores connections for other services', async() => {
            let count = 0;
            M.listen('test', {/* istanbul ignore next */ onConnect() { ++count; }});

            M.connect('other');
            await events.drain(1);
            expect(count).to.equal(0);
        });

        it('fires connection events', async function() {
            let count = 0;
            M.listen('test', {onConnect() { ++count; }});

            M.connect('test');
            await events.drain(1);
            expect(count).to.equal(1);
        });

        it('fires disconnection events', async function() {
            let count = 0;
            M.listen('test', {onDisconnect() {++count}});

            M.connect('test').disconnect();
            await events.drain(2);
            expect(count).to.equal(1);
        });

        it('receives notifications', async function() {
            let notified = false;
            M.listen('test', {onNotify(port, msg) {
                expect(port).to.be.instanceOf(Live.Port);
                expect(msg).to.equal(42);
                notified = true;
            }});

            M.connect('test').notify(42);
            await events.drain(2);
            expect(notified).to.be.true;
        });

        it('responds to requests with failure if onRequest() is not defined', async() => {
            M.listen('test', {});
            const p = M.connect('test').request(42);
            await events.drain(3);
            try {
                await p;
                // istanbul ignore next
                expect(false).to.be.true;
            } catch (e) {
                expect(e).to.be.instanceOf(M.RemoteNanoError);
                expect(e.name).to.equal('NotImplemented');
            }
        });

        it('responds to requests', async() => {
            M.listen('test', {
                async onRequest(sender, msg: number) {
                    expect(msg).to.equal(17);
                    return msg + 2;
                }
            });

            const port = M.connect('test');
            const p = port.request(17);
            await events.drain(3);
            expect(await p).to.equal(19);
        });

        it('responds to requests which fail', async() => {
            M.listen('test', {
                async onRequest(sender, msg) {
                    throw new ReferenceError('oops');
                }
            });

            try {
                const p = M.connect('test').request(17);
                await events.drain(3);
                await p;
                // istanbul ignore next
                expect(false).to.be.true;
            } catch (e) {
                expect(e).to.be.instanceOf(M.RemoteNanoError);
                expect(e.name).to.equal('ReferenceError');
                expect(e.message).to.equal('oops');
            }
        });

        it('responds to parallel requests', async() => {
            M.listen('test', {
                async onRequest(sender, msg: number) {
                    return msg + 4;
                }
            });

            const port1 = M.connect('test');
            const port2 = M.connect('test');
            const p1 = port1.request(4);
            const p2 = port2.request(8);
            await events.drain(6);
            expect(await p1).to.equal(8);
            expect(await p2).to.equal(12);
        });

        it('treats notifications as requests if onNotify() is not defined', async() => {
            M.listen('test', {
                async onRequest(sender, msg: number) {
                    expect(msg).to.equal(89);
                    received = true;
                    return 0;
                }
            });

            let received = true;
            M.connect('test').notify(89);
            await events.drain(2);
            expect(received).to.be.true;
        });
    });
});
