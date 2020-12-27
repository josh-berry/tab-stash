import {tests} from './index.test';
import MockKVS from './memory';

const factory = async() => new MockKVS<string, string>();

describe('datastore/kvs/memory', () => tests(factory));
