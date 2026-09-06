import type {ContextualIdentities as CI, Events} from "webextension-polyfill";

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
  readonly onSiteAssociationChanged: Events.Event<
    (changeInfo: CI.OnSiteAssociationChangedChangeInfoType) => void
  > = new events.MockEvent(
    "browser.contextualIdentities.onSiteAssociationChanged",
  );

  constructor() {
    return;
  }

  /* c8 ignore start -- not implemented */
  getSupportedColors(): Promise<CI.GetSupportedColorsCallbackColorsItemType[]> {
    throw new Error("Method not implemented.");
  }
  getSupportedIcons(): Promise<CI.GetSupportedIconsCallbackIconsItemType[]> {
    throw new Error("Method not implemented.");
  }

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

  async move(
    cookieStoreIds: string | string[],
    position: number,
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async remove(cookieStoreId: string): Promise<CI.ContextualIdentity> {
    throw new Error("Method not implemented.");
  }

  setSiteAssociation(details: CI.SetSiteAssociationDetailsType): Promise<void> {
    throw new Error("Method not implemented.");
  }
  removeSiteAssociation(
    details: CI.RemoveSiteAssociationDetailsType,
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }
  getSiteAssociation(
    details: CI.GetSiteAssociationDetailsType,
  ): Promise<CI.SiteAssociation | undefined> {
    throw new Error("Method not implemented.");
  }
  querySiteAssociations(
    details: CI.QuerySiteAssociationsDetailsType,
  ): Promise<CI.SiteAssociation[]> {
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
