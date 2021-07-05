// This is mostly "gap" test coverage since we get plenty of incidental coverage
// from testing the actual models.  You should look at those for real-world
// examples.

import {expect} from 'chai';
import {reactive} from 'vue';

import * as M from './util';

describe('model/util', () => {
    let index: M.Index<string, {k: string, v: string, i: number}>;

    beforeEach(() => {
        index = new M.Index({
            keyFor(v) { return v.k; },
            positionOf(v) { return v.i; },
            whenPositionChanged(v, i) { v.i = i; },
        });
    });

    it('throws if something non-reactive is inserted', () => {
        expect(() => index.insert({k: 'a', v: 'b', i: 0})).to.throw(Error);
    });

    it('gracefully handles duplicate inserts', () => {
        const v = reactive({k: 'a', v: 'b', i: 0});
        index.insert(v);
        index.insert(v);
        expect(index.get('a')).to.deep.equal([v]);
    });

    it('gracefully handles duplicate deletes', () => {
        const v = reactive({k: 'a', v: 'b', i: 0});
        index.insert(v);
        index.delete(v);
        index.delete(v);
        expect(index.get('a')).to.deep.equal([]);
    });
});
