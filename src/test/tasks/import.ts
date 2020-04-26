import {expect} from 'chai';

import {parse} from '../../tasks/import';

describe('import', function() {
    describe('parse', function() {
        const itf = (desc: string, i: string, o: string[][]) =>
            it(desc, () => expect(parse(i)).to.deep.equal(o));

        itf('parses a single URL',
            "http://example.com/",
            [["http://example.com/"]]);

        itf("parses a single URL with blank lines",
            "\n\nhttp://example.com/\n\n",
            [["http://example.com/"]]);

        itf("ignores leading whitespace",
            "\n  \thttp://foo.com/",
            [["http://foo.com/"]])

        itf("parses a single URL with garbage appended",
            "http://example.com/ | Example",
            [["http://example.com/"]]);

        itf("ignores non-URL-shaped lines",
            "\nhttp://example.com/\nasdf\n",
            [["http://example.com/"]]);

        itf('parses multiple URLs on different lines',
            "\nhttp://example.com/\nhttp://alt.com/\n\n",
            [["http://example.com/", "http://alt.com/"]]);

        itf('parses multiple URLs on different lines with garbage',
            `
http://example.com/\tasdf
  http://ws.com/
   \thttp://wat.com/ fff`,
            [["http://example.com/", "http://ws.com/", "http://wat.com/"]]);

        itf('breaks URL paragraphs into groups',
            `
            http://first.com/
            http://second.com/


            http://alt.com/
            http://whatever.com/
            `,
            [["http://first.com/", "http://second.com/"],
             ["http://alt.com/", "http://whatever.com/"]]);

        itf('parses multiple URLs on the same line',
             `http://foo http://bar.com/`,
             [['http://foo', 'http://bar.com/']]);

        itf('parses URLs in Markdown links',
            `- This is a [markdown link](http://whatever.com)`,
            [["http://whatever.com"]]);

        itf('parses URLs in raw HTML',
            `<a href="http://asdf.com/?test={uuid}#hashtag">link</a>`,
            [["http://asdf.com/?test={uuid}#hashtag"]]);

        itf('ignores file: URLs',
             `file:///c:/windows/system32`, []);

        itf('ignores mailto and other non-authoritative URLs',
            `mailto:foo@bar data:asdf`, []);
    });
});
