// This is mostly "gap" test coverage since we get plenty of incidental coverage
// from testing the actual models.  You should look at those for real-world
// examples.

import {expect} from 'chai';
import {reactive} from 'vue';

import * as events from '../mock/events';

import * as M from './util';

type T = {k: string, v: string, i: number};

describe('model/util', () => {
    let map: M.EventfulMap<string, T>;

    beforeEach(() => {
        map = new M.EventfulMap();
    });

    describe('EventfulMap', () => {
        it('inserts objects and fires onInsert events', async () => {
            map.insert('cat', reactive({k: 'cat', v: 'meow', i: 0}));
            expect(map.get('cat')).to.deep.equal({k: 'cat', v: 'meow', i: 0});
            expect(await events.next(map.onInsert))
                .to.deep.equal(['cat', {k: 'cat', v: 'meow', i: 0}])
        });

        it('updates objects and fires onUpdate events', async () => {
            const obj = reactive({k: 'cat', v: 'meow', i: 0});
            map.insert('cat', obj);
            await events.next(map.onInsert);

            obj.v = 'hello';
            const ev = await events.next(map.onUpdate);
            expect(ev).to.deep.equal(['cat', obj]);
            expect(ev[1]).to.equal(obj);
        });

        it('reports if keys are present in the map', async () => {
            const obj = reactive({k: 'k', v: 'meow', i: 0});
            map.insert('k', obj);
            expect(map.has('k')).to.equal(true);
            expect(map.has('f')).to.equal(false);
            await events.next(map.onInsert);
        });

        it('iterates over the keys in the map', async () => {
            map.insert('a', reactive({k: 'a', v: 'cat', i: 0}));
            map.insert('b', reactive({k: 'b', v: 'cat', i: 1}));
            expect(Array.from(map.keys())).to.deep.equal(['a', 'b']);
            await events.nextN(map.onInsert, 2);
        });

        it('iterates over the values in the map', async () => {
            const a = reactive({k: 'a', v: 'cat', i: 0})
            const b = reactive({k: 'b', v: 'cat', i: 1})
            map.insert('a', a);
            map.insert('b', b);

            const values = Array.from(map.values());
            expect(values[0]).to.equal(a);
            expect(values[1]).to.equal(b);
            expect(values.length).to.equal(2);
            await events.nextN(map.onInsert, 2);
        });

        it('gracefully ignores move()s for invalid keys', () => {
            expect(map.move('nowhere', 'nowhere else')).to.be.undefined;
        });

        it('throws if something non-reactive is inserted', () => {
            expect(() => map.insert('a', {k: 'a', v: 'b', i: 0})).to.throw();
        });
    });

    describe('Index', () => {
        let index: M.Index<string, string, T> | undefined;

        beforeEach(() => {
            index = undefined;
        });

        const mkindex = () => new M.Index(map, {
            keyFor(v) { return v.k; },
            positionOf(v) { return v.i; },
            whenPositionChanged(v, i) { v.i = i; },
        });

        it('detects updates when connected to an existing map', async () => {
            const o = reactive({k: 'f', v: 'v', i: 0});
            map.insert('f', o);
            await events.next(map.onInsert);

            index = mkindex();
            expect(index.get('f')).to.deep.equal([o]);

            o.k = 'g';
            await events.next(map.onUpdate);
            expect(index.get('g')).to.deep.equal([o]);
            expect(index.get('f')).to.deep.equal([]);
        });

        it('reports if entries are present in the index', async () => {
            const o1 = reactive({k: 'f', v: 'v', i: 0});
            map.insert('f', o1);
            await events.next(map.onInsert);

            const idx = new M.Index(map, {
                keyFor(v) { return v.i; }
            });
            expect(idx.has(0)).to.be.true;
            expect(idx.has(1)).to.be.false;
        });

        it('throws on duplicate key insertions', async () => {
            index = mkindex();
            const v = reactive({k: 'a', v: 'b', i: 0});
            map.insert('a', v);
            await events.next(map.onInsert);

            expect(() => map.insert('a', v)).to.throw();
            expect(index.get('a')).to.deep.equal([v]);
        });

        it('throws on duplicate value insertions', async () => {
            index = mkindex();
            const v = reactive({k: 'a', v: 'b', i: 0});
            map.insert('a', v);
            await events.next(map.onInsert);

            expect(() => map.insert('b', v)).to.throw();
            expect(index.get('a')).to.deep.equal([v]);
        });

        it('gracefully handles duplicate deletes', async () => {
            index = mkindex();
            const v = reactive({k: 'a', v: 'b', i: 0});
            map.insert('a', v);
            map.delete('a');
            map.delete('a');
            expect(index.get('a')).to.deep.equal([]);
            await events.next(map.onInsert);
            await events.next(map.onDelete);
        });
    });
});
