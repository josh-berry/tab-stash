import type {Bookmark} from './bookmarks';
import type {Tab} from './tabs';

export function bookmarks(): {root: Bookmark, [k: string]: Bookmark} {
    const root: Bookmark = {id: 'root', title: 'Root', index: 0, children: [
        {id: 'tools', title: 'Toolbar', children: [
            {id: 'likes', title: 'Likes', type: 'folder', children: [
                {id: 'foo', title: 'Foo', url: '/foo'},
                {id: 'bar', title: 'Bar', url: '/bar'},
            ]},
            {id: 'ok', title: 'Okay', url: '/ok'},
        ]},
        {id: 'menu', title: 'Menu', children: [
            {id: 'foo2', title: 'Foo', url: '/foo'},
            {id: 'empty', title: 'Empty Folder'},
            {id: 'sep', title: '', type: 'separator'}, // For Firefox
            {id: 'a', title: 'a', url: '/a'},
            {id: 'subfolder', title: 'Subfolder', children: [
                {id: 'b', title: 'b', url: '/b'},
                {id: 'c', title: 'c', url: '/c'},
                {id: 'd', title: 'd', url: '/d'},
            ]},
        ]},
    ]};

    const res: {[k: string]: Bookmark} = {};

    function gen(bm: Bookmark) {
        if (bm.id in res) throw new Error(`Duplicate bookmark ID ${bm.id}`);
        res[bm.id] = bm;
        if (! bm.children) return;
        let i = 0;
        for (const c of bm.children) {
            c.parentId = bm.id;
            c.index = i;
            gen(c);
            ++i;
        }
    }

    gen(root);
    return res as typeof res & {root: Bookmark};
}

export function tabs(): Tab[] {
    const windows: Partial<Tab>[][] = [
        [
            {url: 'foo'},
            {url: 'bar'},
            {url: 'fred'},
        ],
        [
            {url: 'robert'},
            {url: 'robert'},
            {url: 'foo'},
        ]
    ];

    const tabs: Tab[] = [];
    let windowId = 0;
    let id = 0;
    for (const w of windows) {
        let index = 0;
        for (const t of w) {
            tabs.push(make_tab({...t, id, windowId, index}))
            ++id;
            ++index;
        }
        ++windowId;
    }

    return tabs;
}

export function make_tab(
    t: Partial<Tab> & {id: number, windowId: number, index: number}
): Tab {
    return {
        incognito: false,
        hidden: false,
        pinned: false,
        active: false,
        highlighted: false,
        ...t
    };
}
