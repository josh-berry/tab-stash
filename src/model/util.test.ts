// This is mostly "gap" test coverage since we get plenty of incidental coverage
// from testing the actual models.  You should look at those for real-world
// examples.

import {expect} from 'chai';
import {reactive} from 'vue';

import * as M from './util';

type T = {k: string, v: string, i: number};

describe('model/util', () => {
    let map: M.EventfulMap<string, T>;
    let index: M.Index<string, string, T>;

    beforeEach(() => {
        map = new M.EventfulMap();
        index = new M.Index(map, {
            keyFor(v) { return v.k; },
            positionOf(v) { return v.i; },
            whenPositionChanged(v, i) { v.i = i; },
        });
    });

    it('throws if something non-reactive is inserted', () => {
        expect(() => map.insert('a', {k: 'a', v: 'b', i: 0})).to.throw(Error);
    });

    it('gracefully handles duplicate inserts', () => {
        const v = reactive({k: 'a', v: 'b', i: 0});
        map.insert('a', v);
        map.insert('b', v);
        expect(index.get('a')).to.deep.equal([v]);
    });

    it('gracefully handles duplicate deletes', () => {
        const v = reactive({k: 'a', v: 'b', i: 0});
        map.insert('a', v);
        map.delete('a');
        map.delete('a');
        expect(index.get('a')).to.deep.equal([]);
    });
});
