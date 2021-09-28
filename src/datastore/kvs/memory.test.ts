import {tests} from './index.test';
import MemoryKVS from './memory';

const factory = async() => new MemoryKVS<string, string>('test');

describe('datastore/kvs/memory', () => tests(factory));
