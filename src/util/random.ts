// Generates some random bytes and turns them into a string.  This is
// surprisingly not a one-liner in JS, and is different between the browser and
// Node, so it's done once here.

declare function require(name: string): any;

let makeRandomString: (bytes: number) => string;

// istanbul ignore if
if (/* istanbul ignore next */ (<any>globalThis)?.crypto?.getRandomValues) {
  // Browser
  makeRandomString = (bytes: number): string => {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/=+$/, "");
  };
} else {
  // Node.js (for testing purposes)
  const crypto = require("crypto");
  makeRandomString = (bytes: number): string => {
    const a = crypto.randomBytes(bytes);
    return a.toString("base64").replace(/=+$/, "");
  };
}

export {makeRandomString};
