import {tests} from "./index.test.js";
import MemoryKVS from "./memory.js";

const factory = async () => new MemoryKVS<string, string>("test");

describe("datastore/kvs/memory", () => tests(factory));
