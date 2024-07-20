import type * as DI from "../model/deleted-items.js";

export type RecordGroup = {title: string; records: FilteredDeletion[]};
export type FilteredDeletion = DI.Deletion & {item: FilteredDeletedItem};
export type FilteredDeletedItem = FilteredCount<DI.DeletedItem>;

export type FilteredCount<F> = F & {filtered_count?: number};
