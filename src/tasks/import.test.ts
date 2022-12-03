import {expect} from "chai";

import {extractURLs} from "./import";

describe("import", function () {
  describe("extractURLs", function () {
    const itf = (desc: string, i: string, o: string[]) =>
      it(desc, () => expect(Array.from(extractURLs(i))).to.deep.equal(o));

    itf("parses a single URL", "http://example.com/", ["http://example.com/"]);

    itf("parses a single URL with blank lines", "\n\nhttp://example.com/\n\n", [
      "http://example.com/",
    ]);

    itf("ignores leading whitespace", "\n  \thttp://foo.com/", [
      "http://foo.com/",
    ]);

    itf(
      "parses a single URL with garbage appended",
      "http://example.com/ | Example",
      ["http://example.com/"],
    );

    itf("ignores non-URL-shaped lines", "\nhttp://example.com/\nasdf\n", [
      "http://example.com/",
    ]);

    itf(
      "parses multiple URLs on different lines",
      "\nhttp://example.com/\nhttp://alt.com/\n\n",
      ["http://example.com/", "http://alt.com/"],
    );

    itf(
      "parses multiple URLs on different lines with garbage",
      `
http://example.com/\tasdf
  http://ws.com/
   \thttp://wat.com/ fff`,
      ["http://example.com/", "http://ws.com/", "http://wat.com/"],
    );

    itf("parses multiple URLs on the same line", `http://foo http://bar.com/`, [
      "http://foo",
      "http://bar.com/",
    ]);

    itf(
      "parses URLs in Markdown links",
      `- This is a [markdown link](http://whatever.com)`,
      ["http://whatever.com"],
    );

    // https://github.com/josh-berry/tab-stash/issues/306
    itf(
      "parses URLs that are hiding inside escaped quotes",
      '\\"this is a url: http://nowhere.com/foo\\"',
      ["http://nowhere.com/foo"],
    );

    itf(
      "parses URLs in raw HTML",
      `<a href="http://asdf.com/?test={uuid}#hashtag">link</a>`,
      ["http://asdf.com/?test={uuid}#hashtag"],
    );

    itf(
      "ignores mailto and other non-authoritative URLs",
      `mailto:foo@bar data:asdf`,
      [],
    );
  });
});
