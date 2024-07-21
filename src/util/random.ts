/** Generates some random bytes and turns them into a string.  This is
 * surprisingly not a one-liner in JS, and it used to be different between the
 * browser and Node, so it's done once here. */
export function makeRandomString(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/=+$/, "");
}
