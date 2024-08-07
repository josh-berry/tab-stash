import type {ContextualIdentities as CI} from "webextension-polyfill";

import * as events from "../events.js";

class MockContainers implements CI.Static {
  readonly onCreated: events.MockEvent<
    (createInfo: CI.OnCreatedChangeInfoType) => void
  > = new events.MockEvent("browser.contextualIdentities.onCreated");
  readonly onRemoved: events.MockEvent<
    (removeInfo: CI.OnRemovedChangeInfoType) => void
  > = new events.MockEvent("browser.contextualIdentities.onRemoved");
  readonly onUpdated: events.MockEvent<
    (changeInfo: CI.OnUpdatedChangeInfoType) => void
  > = new events.MockEvent("browser.contextualIdentities.onUpdated");

  constructor() {
    return;
  }

  /* c8 ignore start -- not implemented */
  async get(cookieStoreId: string): Promise<CI.ContextualIdentity> {
    throw new Error("Method not implemented.");
  }

  async query(details: CI.QueryDetailsType): Promise<CI.ContextualIdentity[]> {
    throw new Error("Method not implemented.");
  }

  async create(details: CI.CreateDetailsType): Promise<CI.ContextualIdentity> {
    throw new Error("Method not implemented.");
  }

  async update(
    cookieStoreId: string,
    details: CI.UpdateDetailsType,
  ): Promise<CI.ContextualIdentity> {
    throw new Error("Method not implemented.");
  }

  async remove(cookieStoreId: string): Promise<CI.ContextualIdentity> {
    throw new Error("Method not implemented.");
  }
  /* c8 ignore stop */
}

export default (() => {
  const exports = {
    contextualIdentities: new MockContainers(),

    reset() {
      exports.contextualIdentities = new MockContainers();
      (<any>globalThis).browser.contextualIdentities =
        exports.contextualIdentities;
    },
  };

  exports.reset();

  return exports;
})();
