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

  // istanbul ignore next
  async get(cookieStoreId: string): Promise<CI.ContextualIdentity> {
    throw new Error("Method not implemented.");
  }

  // istanbul ignore next
  async query(details: CI.QueryDetailsType): Promise<CI.ContextualIdentity[]> {
    throw new Error("Method not implemented.");
  }

  // istanbul ignore next
  async create(details: CI.CreateDetailsType): Promise<CI.ContextualIdentity> {
    throw new Error("Method not implemented.");
  }

  // istanbul ignore next
  async update(
    cookieStoreId: string,
    details: CI.UpdateDetailsType,
  ): Promise<CI.ContextualIdentity> {
    throw new Error("Method not implemented.");
  }

  // istanbul ignore next
  async remove(cookieStoreId: string): Promise<CI.ContextualIdentity> {
    throw new Error("Method not implemented.");
  }
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
