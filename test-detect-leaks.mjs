// https://gist.github.com/boneskull/7fe75b63d613fa940db7ec990a5f5843

import {createHook} from "async_hooks";
import {stackTraceFilter} from "mocha/lib/utils.js";

const allResources = new Map();

// this will pull Mocha internals out of the stacks
const filterStack = stackTraceFilter();

const hook = createHook({
  init(asyncId, type, triggerAsyncId) {
    const parent = allResources.get(triggerAsyncId);
    const r = {
      type,
      asyncId,
      stack: filterStack(
        new Error(`${type} ${asyncId} triggered by ${triggerAsyncId}`).stack,
      ),
      parent,
      children: [],
    };
    allResources.set(asyncId, r);

    if (parent) parent.children.push(r);
  },
  destroy(asyncId) {
    allResources.delete(asyncId);
  },
}).enable();

const asyncDump = () => {
  function print(r) {
    let dots = false;
    console.error(r.stack);
    r = r.parent;
    while (r) {
      if (r.parent && r.children.length <= 1) {
        if (!dots) {
          console.error("...");
          dots = true;
        }
        r = r.parent;
        continue;
      }
      print(r);
      r = r.parent;
    }
  }

  hook.disable();

  console.error(`
STUFF STILL IN THE EVENT LOOP:`);
  allResources.forEach(value => {
    if (value.children.length !== 0) return;
    if (value.type === "Immediate") return;
    if (value.type === "PROMISE") return;
    // print(value);
    console.error(value.stack);
    console.error("");
  });
};

export const mochaHooks = {
  afterAll() {
    asyncDump();
  },
};
