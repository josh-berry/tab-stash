// A shim which keeps webextension-polyfill happy inside unit tests.

(<any>globalThis.browser) = {};
import 'webextension-polyfill';
