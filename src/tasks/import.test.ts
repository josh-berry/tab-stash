import {expect} from "chai";
import type {NewTab} from "../model/index.js";

import {extractURLs} from "./import.js";

describe("import", function () {
  describe("extractURLs", function () {
    const itf = (desc: string, i: string, o: NewTab[]) =>
      it(desc, () => expect(Array.from(extractURLs(i))).to.deep.equal(o));

    itf("parses a single URL", "http://example.com/", [
      {url: "http://example.com/"},
    ]);

    itf("parses a single URL with blank lines", "\n\nhttp://example.com/\n\n", [
      {url: "http://example.com/"},
    ]);

    itf("ignores leading whitespace", "\n  \thttp://foo.com/", [
      {url: "http://foo.com/"},
    ]);

    itf("ignores trailing whitespace", "http://foo.com/  \n", [
      {url: "http://foo.com/"},
    ]);

    itf(
      "parses a single URL with a OneTab title",
      "http://example.com/ | Example",
      [{url: "http://example.com/", title: "Example"}],
    );

    itf("ignores non-URL-shaped lines", "\nhttp://example.com/\nasdf\n", [
      {url: "http://example.com/"},
    ]);

    itf(
      "parses multiple URLs on different lines",
      "\nhttp://example.com/\nhttp://alt.com/\n\n",
      [{url: "http://example.com/"}, {url: "http://alt.com/"}],
    );

    itf(
      "parses multiple URLs on different lines with garbage",
      `
http://example.com/\tasdf
  http://ws.com/
   \thttp://wat.com/ fff`,
      [
        {url: "http://example.com/"},
        {url: "http://ws.com/"},
        {url: "http://wat.com/"},
      ],
    );

    itf("parses multiple URLs on the same line", `http://foo http://bar.com/`, [
      {url: "http://foo"},
      {url: "http://bar.com/"},
    ]);

    itf(
      "parses URLs in Markdown links",
      `- This is a [markdown link](http://whatever.com)`,
      [{url: "http://whatever.com", title: "markdown link"}],
    );

    // https://github.com/josh-berry/tab-stash/issues/306
    itf(
      "parses URLs that are hiding inside escaped quotes",
      '\\"this is a url: http://nowhere.com/foo\\"',
      [{url: "http://nowhere.com/foo"}],
    );

    itf(
      "parses URLs in raw HTML",
      `<a href="http://asdf.com/?test={uuid}#hashtag">link</a>`,
      [{url: "http://asdf.com/?test={uuid}#hashtag"}],
    );

    itf(
      "ignores mailto and other non-authoritative URLs",
      `mailto:foo@bar data:asdf`,
      [],
    );
  });
});
