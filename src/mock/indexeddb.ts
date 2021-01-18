import {beforeEach} from 'mocha';
import 'fake-indexeddb/auto';

function reset() {
    // Ugly hack to reach in and clear the internal list of databases in
    // fake-indexeddb so it appears we are starting with no databases at
    // all. :/ Doesn't respect close() or versionChange or anything
    // else.
    (<any>indexedDB)._databases = new Map();
}

beforeEach(reset);

export default {reset};
