// Model for storing/tracking deleted items persistently.  See index.ts for how
// this fits in to the overall Tab Stash model (such as it is).

import {reactive} from "vue";

import {nonReentrant} from "../util";
import {makeRandomString} from "../util/random";

import type {Entry, KeyValueStore, MaybeEntry} from "../datastore/kvs";
import {entryHasValue} from "../datastore/kvs/proto";

// The key for a deleted record should be opaque but monotonically increasing as
// time passes, so items deleted more recently have greater keys.
export type Source = KeyValueStore<string, SourceValue>;
export type SourceValue = {
  deleted_at: string;
  deleted_from?: DeleteLocation;
  item: DeletedItem;
};

export type DeleteLocation = {
  // The folder containing the deleted item
  folder_id: string;
  title: string;
};

export type State = {
  fullyLoaded: boolean;
  entries: Deletion[]; // entries are sorted newest first

  /** Either a count of recently-deleted items, or info on the (single)
   * recently-deleted item. */
  recentlyDeleted: number | Deletion;
};

export type Deletion = {
  key: string;
  deleted_at: Date;
  deleted_from?: DeleteLocation;
  item: DeletedItem;
};

export type DeletedItem = DeletedBookmark | DeletedFolder;

export type DeletedBookmark = {
  title: string;
  url: string;
  favIconUrl?: string;
};

export type DeletedFolder = {
  title: string;
  children: DeletedItem[];
};

export function src2state(e: Entry<string, SourceValue>): Deletion {
  return reactive({
    key: e.key,
    deleted_at: new Date(e.value.deleted_at),
    deleted_from: e.value.deleted_from ? {...e.value.deleted_from} : undefined,
    item: e.value.item,
  });
}

/** Find the child item of a deleted item based on the path.  If the path is
 * empty, the item itself is returned as the `.child`, and `.parent`/`.index`
 * are undefined. */
export function findChildItem(
  item: DeletedItem,
  path?: number[],
): {parent?: DeletedFolder; index?: number; child: DeletedItem} {
  if (!path || path.length == 0) return {child: item};

  let parent = item;
  for (const index of path.slice(0, path.length - 1)) {
    if (!("children" in parent)) {
      throw new Error(`[${path}]: Invalid path in deleted item`);
    }
    parent = parent.children[index];
  }

  const index = path[path.length - 1];
  if (!("children" in parent) || !parent.children[index]) {
    throw new Error(`[${path}]: Invalid path in deleted item`);
  }

  return {parent, index, child: parent.children[index]};
}

const RECENT_DELETION_TIMEOUT = 8000; // ms

export class Model {
  // TODO make this transitively read-only (once I figure out the TypeScript
  // typing issues)
  readonly state: State = reactive({
    fullyLoaded: false,
    entries: [],
    recentlyDeleted: 0,
  });

  private _kvs: KeyValueStore<string, SourceValue>;
  private _entry_cache = new Map<string, Deletion>();
  private _filter: undefined | ((item: DeletedItem) => boolean);

  private _clear_recently_deleted_timeout:
    | undefined
    | ReturnType<typeof setTimeout>;

  constructor(kvs: KeyValueStore<string, SourceValue>) {
    this._kvs = kvs;

    kvs.onSet.addListener(records => this.onSet(records));
    kvs.onSyncLost.addListener(() => this.onSyncLost());
  }

  onSet(records: MaybeEntry<string, SourceValue>[]) {
    const deleted = new Set();

    for (const r of records) {
      if (!entryHasValue(r)) {
        this._entry_cache.delete(r.key);
        deleted.add(r.key);
        continue;
      }

      // If the entry already exists in the cache, just update it.
      if (this._update(r)) continue;

      // Else we don't know about this entry yet.  If it doesn't match the
      // active filter (if any), exclude it no matter what.
      if (this._filter && !this._filter(r.value.item)) continue;

      // If this is a new (to us) entry, then we only insert it if we are
      // already partially loaded AND it's newer than our oldest item.
      // This is done for performance reasons--if we see items older than
      // the oldest item, that item probably won't be visible in the UI
      // and we're bloating our memory usage for no reason.  So we tell
      // the model it's not fully-loaded anymore and let it decide how
      // much to load.
      const deleted_at = new Date(r.value.deleted_at);
      const oldest =
        this.state.entries.length > 0
          ? this.state.entries[this.state.entries.length - 1]
          : undefined;

      if (!oldest || deleted_at.valueOf() < oldest.deleted_at.valueOf()) {
        this.state.fullyLoaded = false;
        continue;
      }

      this._insert(r);
    }

    if (deleted.size > 0) {
      this.state.entries = this.state.entries.filter(
        ({key}) => !deleted.has(key),
      );

      if (
        typeof this.state.recentlyDeleted === "object" &&
        deleted.has(this.state.recentlyDeleted.key)
      ) {
        this.state.recentlyDeleted = 0;
      }
    }
  }

  onSyncLost() {
    // If we lost some events from the KVS, we need to assume we are no
    // longer fully-loaded.  The easiest way to make sure we have an
    // accurate picture of the state is simply to (ask the UI to) reload
    // everything.
    //
    // The user will lose their scroll position in the deleted-items page,
    // but since this is a relatively rare occurrence, I don't think it will
    // be that much of a problem.
    this.state.entries = [];
    this.state.fullyLoaded = false;
  }

  filter(predicate?: (item: DeletedItem) => boolean) {
    // This resets the model to the "empty" state.  On subsequent calls to
    // loadMore(), we will load only those records whose root DeletedItems
    // match the predicate (we do NOT search recursively; that's up to the
    // predicate if desired).
    //
    // We do top-level filtering in here for performance reasons--by lazily
    // loading/reloading filtered data, we can keep the number of elements
    // we report to the UI down, which keeps the UI responsive, because we
    // should rarely need potentially thousands of DOM nodes squeezed onto
    // the page.
    //
    // If the UI wants to filter *within* particular items, the UI needs to
    // do this by hand.  This strikes a balance between "heavy-lifting"
    // filtering which potentially ignores many, many items, and
    // fine-grained filtering in the UI (which can do nice things like
    // report the number of items filtered).
    this.state.fullyLoaded = false;
    this.state.entries = [];
    this._entry_cache = new Map();
    this._filter = predicate;
  }

  loadMore = nonReentrant(async () => {
    const starting_filter = this._filter;
    const starting_count = this.state.entries.length;
    let bound =
      this.state.entries.length > 0
        ? this.state.entries[this.state.entries.length - 1].key
        : undefined;

    // block.length might be > 0, and yet no entries will be loaded, if a
    // search is active.  In this case, we want to keep trying until we can
    // load at least one entry, or the infinite-loading component I'm using
    // in Vue will complain (and doing this is faster anyway).
    while (starting_count === this.state.entries.length) {
      // Check if we need to cancel the load because our filter has changed
      if (starting_filter !== this._filter) break;

      const block = await this._kvs.getEndingAt(bound, 10);
      for (const rec of block) {
        if (this._filter && !this._filter(rec.value.item)) continue;

        // istanbul ignore else -- We should always insert because we're
        // loading starting at the oldest item.
        if (!this._update(rec)) this._insert(rec);
      }

      if (block.length === 0) {
        this.state.fullyLoaded = true;
        break;
      }
      bound = block[block.length - 1].key;
    }
  });

  async add(
    item: DeletedItem,
    deleted_from?: DeleteLocation,
    deleted_at?: Date,
  ): Promise<Entry<string, SourceValue>> {
    if (!deleted_at) deleted_at = new Date();

    const entry = {
      key: genKey(deleted_at),
      value: {
        deleted_at: deleted_at.toISOString(),
        deleted_from,
        // Get rid of reactivity (if any)
        item: JSON.parse(JSON.stringify(item)),
      },
    };

    await this._kvs.set([entry]);
    // We will get an event that the entry has been added, which may either
    // insert it in the state directly (if it's new enough) or mark
    // ourselves as no longer fully-loaded (prompting the UI to loadMore()
    // if it wants).

    // Keep track of items we ourselves just deleted so the UI can show an
    // "Undo" notification.
    if (this.state.recentlyDeleted === 0) {
      this.state.recentlyDeleted = src2state(entry);
    } else if (typeof this.state.recentlyDeleted === "object") {
      this.state.recentlyDeleted = 2;
    } else {
      ++this.state.recentlyDeleted;
    }

    // And we forget recently-deleted items after a timeout.
    if (this._clear_recently_deleted_timeout) {
      clearTimeout(this._clear_recently_deleted_timeout);
    }
    this._clear_recently_deleted_timeout = setTimeout(() => {
      this.state.recentlyDeleted = 0;
      this._clear_recently_deleted_timeout = undefined;
    }, RECENT_DELETION_TIMEOUT);

    return entry;
  }

  /** Remove a deleted item (or part of a deleted item) from the deleted-items
   * database.
   *
   * Note that after a partial deletion, the path indexes after the removed item
   * will decrement---that is, this is equivalent to doing an
   * `Array.splice(index, 1)`.
   *
   * @param key The specific deletion to remove.
   *
   * @param path If specified and `path.length > 0`, remove only part of the
   * specified deletion.  This is the path of array indexes to follow to the
   * item to remove.
   */
  async drop(key: string, path?: number[]): Promise<void> {
    if (!path || path.length == 0) {
      // We will get an event for the deletion later
      return await this._kvs.set([{key}]);
    }

    const entry = this._entry_cache.get(key);
    // istanbul ignore next
    if (!entry) throw new Error(`${key}: Record not loaded or doesn't exist`);

    // Must do a full JSON parse/stringify here to get rid of reactivity
    const item = JSON.parse(JSON.stringify(entry.item)) as DeletedItem;

    // In-place remove the subtree at indexPath.  We know that parent and index
    // must be defined because we check above that path.length > 0.
    const {parent, index} = findChildItem(item, path);
    parent!.children.splice(index!, 1);

    // Store the modified item (with the subtree removed above) back into
    // the KVS
    await this._kvs.set([
      {
        key,
        value: {
          deleted_at: entry.deleted_at.toISOString(),
          item: item,
        },
      },
    ]);
  }

  // Cleanup deleted items which are older than the specified date.
  //
  // We go directly to the KVS regardless of what's loaded into the model
  // because that way we are guaranteed to see everything, and we don't want
  // to pollute the model with stuff we're about to delete.
  async dropOlderThan(timestamp: number): Promise<void> {
    while (true) {
      const to_delete = [];
      for (const rec of await this._kvs.getStartingFrom(undefined, 50)) {
        if (Date.parse(rec.value.deleted_at) < timestamp) {
          to_delete.push({key: rec.key});
        }
      }

      if (to_delete.length > 0) await this._kvs.set(to_delete);
      else break;
    }
  }

  clearRecentlyDeletedItems() {
    if (this._clear_recently_deleted_timeout) {
      clearTimeout(this._clear_recently_deleted_timeout);
    }
    this.state.recentlyDeleted = 0;
    this._clear_recently_deleted_timeout = undefined;
  }

  /** Insert and return a reactive entry in the model state.  This could be a
   * completely new item we just got an event for, or it could be called as
   * part of loading additional items on demand. */
  private _insert(rec: Entry<string, SourceValue>): Deletion {
    const ent = src2state(rec);
    this._entry_cache.set(rec.key, ent);

    if (ent.deleted_at > this.state.entries[0]?.deleted_at) {
      // This is the newest entry so it always goes first.
      this.state.entries.unshift(ent);
    } else {
      // Somehow this is a "new" entry we haven't seen before, but
      // it's older than the newest entry in the list.  Insert it and
      // make sure the entry list stays sorted.
      //
      // TODO this is slow but hopefully very rare
      this.state.entries.push(ent);
      this.state.entries.sort(
        (a, b) => b.deleted_at.valueOf() - a.deleted_at.valueOf(),
      );
    }

    return ent;
  }

  /** Update an entry in the model state, if it already exists.  If the entry
   * is found, it is returned.  Otherwise `undefined` is returned, and the
   * caller is expected to `_insert()` the entry if desired. */
  private _update(rec: Entry<string, SourceValue>): Deletion | undefined {
    const cached = this._entry_cache.get(rec.key);
    if (cached) {
      cached.deleted_at = new Date(rec.value.deleted_at);
      cached.item = rec.value.item;
      return cached;
    }
    return undefined;
  }

  /** **FOR TEST ONLY:** Generate a lot of garbage/fake deleted items for
   * (manual) performance and scale testing, and real-world testing of the
   * UI's lazy-loading behavior.
   *
   * The `batch_size` is the number of entries to insert at once, while
   * `count` is the total number of fake entries to generate.  A random
   * combination of individual items and folders is generated. */
  async makeFakeData_testonly(count: number, batch_size = 1) {
    let ts = Date.now();
    const icons = [
      "back.svg",
      "cancel.svg",
      "collapse-closed.svg",
      "delete.svg",
      "logo.svg",
      "mainmenu.svg",
      "new-empty-group.svg",
      "restore-del.svg",
      "stash-one.svg",
      "stash.svg",
    ];
    const words = [
      "deleted",
      "internal",
      "cat",
      "nonsense",
      "wakka",
      "yakko",
      "dot",
      "gazebo",
      "meow",
      "mew",
      "bark",
      "widget",
      "boat",
      "car",
      "rental",
      "code",
      "monad",
      "block",
      "function",
      "trivia",
      "noise",
      "signal",
    ];
    const choose = (a: any[]) => a[Math.floor(Math.random() * a.length)];
    const genTitle = () => `${choose(words)} ${choose(words)} ${choose(words)}`;
    const genUrl = () =>
      `https://${choose(words)}.internet/${choose(words)}/${choose(
        words,
      )}/${choose(words)}.html`;
    const genIcon = () => `icons/light/${choose(icons)}`;

    let items: Entry<string, SourceValue>[] = [];

    for (let i = 0; i < count; ++i) {
      const deleted_at = new Date(ts);
      const key = genKey(deleted_at);
      ts -= Math.floor(Math.random() * 6 * 60 * 60 * 1000);

      if (Math.random() < 0.5) {
        items.push({
          key,
          value: {
            deleted_at: deleted_at.toISOString(),
            item: {
              title: genTitle(),
              children: (() => {
                const res = [];
                for (let i = 0; i < Math.random() * 10 + 1; ++i) {
                  res.push({
                    title: genTitle(),
                    url: genUrl(),
                    favIconUrl: genIcon(),
                  });
                }
                return res;
              })(),
            },
          },
        });
      } else {
        items.push({
          key,
          value: {
            deleted_at: deleted_at.toISOString(),
            deleted_from: {
              folder_id: choose(words),
              title: genTitle(),
            },
            item: {
              title: genTitle(),
              url: genUrl(),
              favIconUrl: genIcon(),
            },
          },
        });
      }

      if (items.length >= batch_size) {
        await this._kvs.set(items);
        items = [];
      }
    }

    if (items.length > 0) await this._kvs.set(items);
  }
}

let key_seq_no = 0;
let last_key_date = Date.now();

/** Generates a key for a deleted item which is extremely likely to result in
 * deleted items being sorted in the order they were deleted.  (I say "extremely
 * likely" because for real-world scenarios, this is practically always the
 * case, but it cannot be guaranteed without some global synchronization.)
 *
 * More precisely, returned keys are monotonically increasing with respect to:
 *
 * 1. The `deleted_at` time, and
 * 2. The number of times this function has been called in the current
 *    JavaScript context. (Up to a limit of 100,000 items.)
 */
function genKey(deleted_at: Date): string {
  if (deleted_at.valueOf() !== last_key_date) {
    key_seq_no = 0;
    last_key_date = deleted_at.valueOf();
  }

  key_seq_no++;

  return `${deleted_at.toISOString()}-${(1000000 - key_seq_no)
    .toString()
    .padStart(6, "0")}-${makeRandomString(4)}`;
}
