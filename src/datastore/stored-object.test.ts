import {expect} from "chai";
import browser from "webextension-polyfill";

import storage_mock from "../mock/browser/storage";
import * as events from "../mock/events";

import type {
  StorableDef,
  StorableType,
  StorableValue,
  StoredObject,
} from "./stored-object";
import {
  _StoredObjectFactory,
  aBoolean,
  aNumber,
  aString,
  anEnum,
  maybeNull,
  maybeUndef,
} from "./stored-object";

describe("stored-object", function () {
  describe("mocks", function () {
    it("stores and retrieves single values", async function () {
      const obj = {foo: "bar"};
      await browser.storage.local.set(obj);
      expect(await browser.storage.local.get("foo")).to.deep.equal(obj);
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
    });

    it("stores and retrieves multiple values", async function () {
      const obj = {
        foo: "bar",
        obj: {a: 1, b: 2},
      };
      await browser.storage.local.set(obj);
      expect(await browser.storage.local.get(["foo", "obj"])).to.deep.equal(
        obj,
      );
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
    });

    it("deletes single values", async function () {
      await browser.storage.local.set({foo: "bar"});
      await browser.storage.local.remove("foo");
      expect(await browser.storage.local.get()).to.deep.equal({});
      await events.nextN(browser.storage.onChanged, 2);
      await events.nextN(browser.storage.local.onChanged, 2);
    });

    it("deletes multiple values", async function () {
      await browser.storage.local.set({foo: "bar", bar: "baz"});
      await browser.storage.local.remove(["foo", "bar"]);
      expect(await browser.storage.local.get()).to.deep.equal({});
      await events.nextN(browser.storage.onChanged, 2);
      await events.nextN(browser.storage.local.onChanged, 2);
    });

    it("is empty on startup", async function () {
      expect(await browser.storage.local.get()).to.deep.equal({});
    });

    it("delivers events on object creation", async function () {
      let fired = 0;
      browser.storage.onChanged.addListener((changes, area) => {
        expect("oldValue" in changes.foo).to.equal(false);
        expect(changes.foo.newValue).to.equal(5);
        expect(area).to.equal("local");
        fired++;
      });
      await browser.storage.local.set({foo: 5});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      expect(fired).to.equal(1);
    });

    it("delivers events on object update", async function () {
      let fired = 0;
      await browser.storage.local.set({foo: 5});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      browser.storage.onChanged.addListener((changes, area) => {
        expect(changes.foo.oldValue).to.equal(5);
        expect(changes.foo.newValue).to.equal(10);
        expect(area).to.equal("local");
        fired++;
      });
      await browser.storage.local.set({foo: 10});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      expect(fired).to.equal(1);
    });

    it("delivers events on object deletion", async function () {
      let fired = 0;
      await browser.storage.local.set({foo: 5});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      browser.storage.onChanged.addListener((changes, area) => {
        expect(changes.foo.oldValue).to.equal(5);
        expect("newValue" in changes.foo).to.equal(false);
        expect(area).to.equal("local");
        fired++;
      });
      await browser.storage.local.remove("foo");
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      expect(fired).to.equal(1);
    });
  });

  describe("behaviors", function () {
    storage_mock.reset();
    let factory = new _StoredObjectFactory();

    const DEF: StorableDef = {
      a: {default: 1, is: aNumber},
      b: {default: 2, is: aNumber},
      foo: {default: "bar", is: aString},
      bar: {default: "foo", is: aString},
      bool: {default: false, is: aBoolean},
      enum: {default: "maybe", is: anEnum("yes", "no", "maybe")},
      tristate: {default: null, is: maybeNull(aBoolean)},
      undef: {default: undefined, is: maybeUndef(aNumber)},
    };

    const defaults = <D extends StorableDef>(def: D) =>
      Object.keys(def).reduce((obj: StoredObject<D>, k: keyof D) => {
        (<any>obj)[k] = def[k].default;
        return obj;
      }, {} as StoredObject<D>);

    beforeEach(function () {
      // Reload the factory and reset the mocks for each test so the test
      // has a clean environment with which to start.  This hackery is
      // needed because the mocks have to simulate persistent/global
      // state, after all. :)
      storage_mock.reset();
      factory = new _StoredObjectFactory();
    });

    it("retrieves the same object when asked multiple times", async function () {
      const o = factory.get("local", "foo", DEF);
      const o2 = factory.get("local", "foo", DEF);
      expect(await o).to.equal(await o2);
    });

    it("distinguishes between different objects", async function () {
      const o = await factory.get("local", "foo", DEF);
      const o2 = await factory.get("local", "bar", DEF);
      expect(o).not.to.equal(o2);
    });

    it("loads non-existent objects with defaults", async function () {
      const o = await factory.get("local", "foo", DEF);
      expect(o.state).to.deep.equal(defaults(DEF));
    });

    it("loads existent objects with all defaults", async function () {
      await browser.storage.local.set({foo: {}});
      const o = await factory.get("local", "foo", DEF);
      expect(o.state).to.deep.equal(defaults(DEF));
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next(o.onChanged);
    });

    it("loads existent objects with some defaults overridden", async function () {
      const OVERRIDES = {a: 42, bar: "fred"};

      await browser.storage.local.set({foo: OVERRIDES});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);
      expect(o.state).to.deep.equal(
        Object.assign({}, defaults(DEF), OVERRIDES),
      );
    });

    it("updates objects which have been created out-of-band", async function () {
      const o = await factory.get("local", "foo", DEF);

      await browser.storage.local.set({foo: {a: 42}});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next(o.onChanged);

      expect(o.state).to.deep.equal(Object.assign({}, defaults(DEF), {a: 42}));
    });

    it("updates objects which have been updated out-of-band", async function () {
      await browser.storage.local.set({foo: {a: 42}});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);

      await browser.storage.local.set({foo: {a: 17}});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next(o.onChanged);

      expect(o.state).to.deep.equal(Object.assign({}, defaults(DEF), {a: 17}));
    });

    it("updates objects which have been deleted out-of-band", async function () {
      await browser.storage.local.set({foo: {a: 42}});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);

      await browser.storage.local.remove("foo");
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next(o.onChanged);

      expect(o.state).to.deep.equal(defaults(DEF));
    });

    it("fires events for objects which have been created out-of-band", async function () {
      const o = await factory.get("local", "foo", DEF);

      await browser.storage.local.set({foo: {a: 42}});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      expect(await events.next(o.onChanged)).to.deep.equal([o]);
      expect(o.state).to.deep.equal(Object.assign({}, defaults(DEF), {a: 42}));
    });

    it("fires events for objects which have been updated out-of-band", async function () {
      await browser.storage.local.set({foo: {a: 42}});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);

      await browser.storage.local.set({foo: {a: 17}});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      expect(await events.next(o.onChanged)).to.deep.equal([o]);
      expect(o.state).to.deep.equal(Object.assign({}, defaults(DEF), {a: 17}));
    });

    it("fires events for objects which have been deleted out-of-band", async function () {
      await browser.storage.local.set({foo: {a: 42}});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);

      await browser.storage.local.remove("foo");
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      expect(await events.next(o.onChanged)).to.deep.equal([o]);
      expect(o.state).to.deep.equal(Object.assign({}, defaults(DEF)));
    });

    it("sets values which are not the default", async function () {
      const OVERRIDES = {a: 42, bar: "fred"};
      const o = await factory.get("local", "foo", DEF);
      expect(o.state).to.deep.equal(defaults(DEF));

      await o.set(OVERRIDES);
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      expect(await events.next(o.onChanged)).to.deep.equal([o]);

      expect(await browser.storage.local.get("foo")).to.deep.equal({
        foo: OVERRIDES,
      });
      expect(o.state).to.deep.include(
        Object.assign({}, defaults(DEF), OVERRIDES),
      );
    });

    it("sets non-default values to other non-default values", async function () {
      const OVERRIDES = {a: 42, bar: "fred"};
      await browser.storage.local.set({foo: OVERRIDES});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);

      await o.set({a: 17});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next(o.onChanged);

      expect(await browser.storage.local.get("foo")).to.deep.equal({
        foo: Object.assign({}, OVERRIDES, {a: 17}),
      });
      expect(o.state).to.deep.equal(
        Object.assign({}, defaults(DEF), OVERRIDES, {a: 17}),
      );
    });

    it("converts loaded values which are the wrong type", async () => {
      const OVERRIDES = {a: "42"};
      await browser.storage.local.set({foo: OVERRIDES});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);
      expect(o.state).to.deep.include({a: 42});
    });

    it("converts saved values which are the wrong type", async () => {
      const OVERRIDES = {a: 42};
      await browser.storage.local.set({foo: OVERRIDES});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);

      await o.set({a: "17" as any});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next(o.onChanged);

      expect(await browser.storage.local.get("foo")).to.deep.equal({
        foo: {a: 17},
      });
    });

    it("resets non-default values to the default", async function () {
      const OVERRIDES = {a: 42, bar: "fred"};
      await browser.storage.local.set({foo: OVERRIDES});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);

      await o.set({a: 1});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next(o.onChanged);

      expect(await browser.storage.local.get("foo")).to.deep.equal({
        foo: {bar: "fred"},
      });
      expect(o.state).to.deep.equal(
        Object.assign({}, defaults(DEF), {bar: "fred"}),
      );
    });

    it("resets non-default values to the default after type-casting", async () => {
      const OVERRIDES = {a: 42, bar: "fred"};
      await browser.storage.local.set({foo: OVERRIDES});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);

      const o = await factory.get("local", "foo", DEF);

      await o.set({a: "1" as any});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next(o.onChanged);

      expect(await browser.storage.local.get("foo")).to.deep.equal({
        foo: {bar: "fred"},
      });
      expect(o.state).to.deep.include(
        Object.assign({}, defaults(DEF), {bar: "fred"}),
      );
    });

    it("deletes non-existent objects from the store", async function () {
      const o = await factory.get("sync", "foo", DEF);

      await o.delete();
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.sync.onChanged);
      await events.next(o.onChanged);

      expect(await browser.storage.local.get()).to.deep.equal({});
      expect(o.state).to.deep.include(defaults(DEF));
    });

    it("deletes existing objects from the store", async function () {
      const o = await factory.get("sync", "foo", DEF);

      await o.set({a: 2});
      await o.delete();
      await events.nextN<any>(
        [
          browser.storage.onChanged,
          browser.storage.sync.onChanged,
          o.onChanged,
        ],
        7,
      );

      expect(await browser.storage.local.get()).to.deep.equal({});
      expect(o.state).to.deep.include(defaults(DEF));
    });

    it("resurrects deleted objects when modified", async function () {
      const o = await factory.get("sync", "foo", DEF);

      await o.delete();
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.sync.onChanged);
      await events.next(o.onChanged);

      await o.set({a: 2});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.sync.onChanged);
      await events.next(o.onChanged);

      const o2 = await factory.get("sync", "foo", DEF);

      expect(o).to.equal(o2);
    });

    it("drops keys it does not recognize on save", async function () {
      const DATA = {foo: {asdf: "qwer"}};
      await browser.storage.sync.set(DATA);
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.sync.onChanged);

      const o = await factory.get("sync", "foo", DEF);
      expect(o.state).to.deep.equal(defaults(DEF));
      expect(await browser.storage.sync.get()).to.deep.equal(DATA);

      await o.set({a: 1});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.sync.onChanged);
      await events.next(o.onChanged);

      expect(await browser.storage.sync.get()).to.deep.equal({foo: {}});
      expect(o.state).to.deep.include(defaults(DEF));
    });

    describe("invalid stored values", function () {
      function test(name: string, obj: any, field: keyof typeof DEF) {
        it(`converts invalid ${name}`, async () => {
          await browser.storage.local.set({obj});
          await events.next(browser.storage.onChanged);
          await events.next(browser.storage.local.onChanged);
          const o = await factory.get("local", "obj", DEF);
          expect(o.state[field]).to.equal(DEF[field].default);
        });
      }
      test("booleans", {bool: "string"}, "bool");
      test("integers", {a: "pi"}, "a");
      //test('strings', {}) -- things can always become strings
      test("enums", {enum: "whatever"}, "enum");
      test("maybe-null booleans", {tristate: "string"}, "bool");
      test("maybe-undefined numbers", {undef: "three"}, "undef");
    });
  });

  describe("data definitions", () => {
    const fallback = Symbol("fallback");
    function check<V extends StorableValue>(
      fn: StorableType<V>,
      value: any,
      expected: V | typeof fallback,
    ) {
      it(`${JSON.stringify(value)} is ${
        expected !== fallback ? expected : "the fallback value"
      }`, () => expect(fn(value, fallback as any)).to.equal(expected));
    }

    describe("aBoolean", () => {
      check(aBoolean, undefined, fallback);
      check(aBoolean, null, false);
      check(aBoolean, true, true);
      check(aBoolean, 1, true);
      check(aBoolean, "true", true);
      check(aBoolean, "TRUE", true);
      check(aBoolean, "yes", true);
      check(aBoolean, "YES", true);
      check(aBoolean, false, false);
      check(aBoolean, 0, false);
      check(aBoolean, "false", false);
      check(aBoolean, "FALSE", false);
      check(aBoolean, "no", false);
      check(aBoolean, "NO", false);
      check(aBoolean, 42, true);
      check(aBoolean, "kumquat", fallback);
      check(aBoolean, [], fallback);
      check(aBoolean, {}, fallback);
      check(aBoolean, Symbol(), fallback);
    });

    describe("aNumber", () => {
      check(aNumber, undefined, fallback);
      check(aNumber, null, fallback);
      check(aNumber, true, 1);
      check(aNumber, false, 0);
      check(aNumber, NaN, fallback);
      check(aNumber, Infinity, Infinity);
      check(aNumber, -Infinity, -Infinity);
      check(aNumber, 0, 0);
      check(aNumber, 42, 42);
      check(aNumber, 3.1416, 3.1416);
      check(aNumber, "42", 42);
      check(aNumber, "42.64", 42.64);
      check(aNumber, "-42.64", -42.64);
      check(aNumber, "seven", fallback);
      check(aNumber, "7afe", fallback);
      check(aNumber, [], fallback);
      check(aNumber, {}, fallback);
      check(aNumber, Symbol(), fallback);
    });

    describe("aString", () => {
      check(aString, undefined, fallback);
      check(aString, null, fallback);
      check(aString, "", "");
      check(aString, "foo", "foo");
      check(aString, 5, "5");
      check(aString, true, "true");
      check(aString, false, "false");
      check(aString, [], fallback);
      check(aString, {}, fallback);
      check(aString, Symbol(), fallback);
    });

    describe("maybeUndef", () => {
      const dt = maybeUndef(aString);
      check(dt, undefined, undefined);
      check(dt, null, undefined);
      check(dt, "", "");
      check(dt, "foo", "foo");
      check(dt, 42, "42");
      check(dt, true, "true");
      check(dt, [], fallback);
    });

    describe("maybeNull", () => {
      const dt = maybeNull(aString);
      check(dt, undefined, null);
      check(dt, null, null);
      check(dt, "", "");
      check(dt, "foo", "foo");
      check(dt, 42, "42");
      check(dt, true, "true");
      check(dt, [], fallback);
    });

    describe("anEnum", () => {
      const dt = anEnum("foo", "bar");
      check(dt, undefined, fallback);
      check(dt, null, fallback);
      check(dt, "", fallback);
      check(dt, "foo", "foo");
      check(dt, "bar", "bar");
      check(dt, "other", fallback);
      check(dt, true, fallback);
      check(dt, 42, fallback);
      check(dt, [], fallback);
    });
  });
});
