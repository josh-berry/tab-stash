/***** BEGIN DOCUMENTATION AND CLEVER USE OF MULTI-LINE COMMENTS

// A hierarchical task-tracking and progress-reporting module.
//
// HOW PROGRESS IS TRACKED AND REPORTED
//
// Progress can be monitored using a hierarchy of `Progress` objects.  Each
// Progress object has a `.status` field, which is a user-friendly string
// describing the task (or current step in the task).  It also has `.value` and
// `.max` fields.  `value` is a number representing how much progress has been
// made so far, while `max` is a number estimating the total work required.
// `value` (and less commonly, `max`) will be updated as the task makes
// progress.  When `value >= max`, the task is complete.
//
// Each Progress object incorporates the progress of all of its children
// (enumerable using the `children` field).  When a child's `value` and `max`
// are updated, these updates are scaled according to the child's `weight` and
// automatically incorporated into the parent's `value`.
//
// The child's `weight` is a scale factor indicating the amount the parent
// `value` should change as the child is completed.  For example, suppose a
// child has a max of 100 and a weight of 5.  If the child's value increases
// from 0 to 50, the parent's value will increase by 2.5.  Once the child goes
// all the way to 100, the parent's value will have increased by 5.
//
// IMPLEMENTING TASKS WHICH REPORT PROGRESS
//
// To implement a task which reports progress, you need to take a TaskMonitor
// object for an argument and update it periodically by setting its `max`,
// `status` and `value` fields.  The TaskMonitor provides a user-friendly way to
// report progress to anyone interested--in effect, it wraps the Progress object
// described earlier and provides additional functionality for spawning child
// tasks and dealing with task cancellation (discussed later).  Here is how to
// implement a simple task function:

import { Task } from "../util";

async function simpleWorker(data: any[], tm: TaskMonitor) {
    // Predict how much work we have to do
    tm.max = data.length;

    for (const x of data) {
        // Report what we are about to work on.
        tm.status = `Working on ${x}...`;

        await doSomethingWith(x);

        // Once the work is done, increment tm.value to show progress.
        ++tm.value;
    }
}

// Then, to run your simpleWorker(), you can call it with TaskMonitor.run():

async function main() {
    const task = TaskMonitor.run(tm => simpleWorker(data, tm));

    const i = setInterval(
        () => { console.log(task.progress.value, task.progress.max); },
        1000);

    const result = await task;
    clearInterval(i);
}

// The return value of TaskMonitor.run() (and the various TaskMonitor.spawn*()
// methods, which we will see next) is an augmented Promise object.  This
// Promise has an additional `.progress` property for getting progress
// information as described above.  It also has a `.cancel()` method, discussed
// later.

// IMPLEMENTING TASKS WHICH CALL SUB-TASKS
//
// Sometimes you might want to delegate some work to a callee function which
// also takes a TaskMonitor.  There are two ways to do this.  If your callee
// already returns a Promise or can be trivially wrapped in a Promise, there's
// the easy way:

async function theEasyWay(data: any[], parent_tm: TaskMonitor) {
    parent_tm.max = data.length;

    for (const x of data) {
        parent_tm.status = `Working on ${x}...`;

        await parent_tm.spawn(child_tm => asyncCallee(x, child_tm));

        // tm.value is automatically incremented in fractional steps as the
        // callee makes progress.
    }
}

// But if your callee doesn't take a Promise or you need to manually construct a
// TaskMonitor for some reason, you can do the slightly harder way:

async function theHardWay(data: any[], parent_tm: TaskMonitor) {
    parent_tm.max = data.length;

    for (const x of data) {
        parent_tm.status = `Working on ${x}...`;

        await new Promise(resolve => {
            const child_tm = new TaskMonitor(parent_tm);
            calleeWithCallback(x, child_tm, result => {
                resolve(result);
                // Must call detach() to remove the child from the parent once
                // the child has finished its work.
                child_tm.detach();
            });
        });

        // tm.value is automatically incremented in fractional steps as the task
        // makes progress.
    }
}

// SPECIFYING WEIGHTS OF CHILD TASKS
//
// By default, child tasks are spawned or created with a weight of 1--meaning
// the parent progress's `.value` will go up by 1 over the entire course of the
// child task.  But sometimes that's not appropriate--you may want to have a
// fractional weight (e.g. a child is responsible for 25% of the work), or a
// larger weight (e.g. each child is responsible for 10 items).
//
// As before, there are two ways to do this--instead of spawn(), you can use
// wspawn() and pass the weight as the first parameter:

async function spawnWithWeight(parent_tm: TaskMonitor) {
    await parent_tm.wspawn(10, child_tm => doWork(child_tm));
}

// Or if you are constructing a TaskMonitor manually, you can pass the weight as
// the second parameter to the constructor:

function constructWithWeight(parent_tm: TaskMonitor) {
    const child_tm = new TaskMonitor(parent_tm, 10);
    doWork(child_tm, result => {
        // ...
        child_tm.detach();
    })
}

// PARALLEL CHILD TASKS
//
// Here's another example of creating TMs for child tasks that run in parallel.
// We also show how to give each child task different weights, so the parent's
// progress bar advances at a different rate depending on which child is making
// progress.

async function parallelWorkers(parent_tm: TaskMonitor) {
    parent_tm.max = 100;

    // This child is responsible for 75% of the work.
    const worker = parent_tm.wspawn(75, child_tm => workerTask(child_tm));

    // This child is responsible for 25% of the work.
    const slacker = parent_tm.wspawn(25, child_tm => slackerTask(child_tm));

    // Again, note that the children themselves may further sub-divide the work
    // in ways that are opaque to the parent, but no matter how the work is
    // sub-divided, the top-level progress bar will always advance according to
    // the relative weights defined above.

    await worker;
    await slacker;
}

// CANCELLATION
//
// To cancel a running task, a caller can call the `.cancel()` method on the
// TaskMonitor (if using manual construction) or the augmented Promise returned
// by `TaskMonitor.run()` or `TaskMonitor.spawn()` and friends.
//
// If a caller does call `cancel()`, the caller must expect that the task's
// Promise may or may not reject (or the task will otherwise fail) with a
// `TaskCancelled` exception.  Callers must not allow `TaskCancelled` to bubble
// unless the caller was itself cancelled.

async function iChangedMyMind() {
    const child = TaskMonitor.run(someTask);

    child.cancel();

    try {
        await child;
        // Child might run to completion...
    } catch (e) {
        if (e instanceof TaskCancelled) {
            // ...or throw/reject with TaskCancelled
        } else {
            throw e;
        }
    }
}

// Cancellation is opt-in; if a task does not support cancellation, calling
// `cancel()` will have no effect and the task will run to completion.
//
// On the callee side, by default, `cancel()` does nothing.  Callees can
// explicitly check for cancellation by checking their TaskMonitor's
// `.cancelled` property at opportune moments and acting accordingly.  If a
// callee decides to terminate prematurely due to cancellation, it is strongly
// recommended to throw, reject with, or otherwise return a `TaskCancelled`
// error.

async function explicitCancelChecking(tm: TaskMonitor) {
    tm.max = 1000;
    for (const i = 0; i < 1000; ++i) {
        await doSomething(i);
        if (tm.cancelled) throw new TaskCancelled();
        ++tm.value;
    }
}

// If explicitly checking `.cancelled` is too much of a hassle, callees can ask
// TaskMonitor to throw a `TaskCancelled` exception on their behalf by calling
// TaskMonitor's `.throw_on_cancel()`.  This exception will be thrown after any
// update to the TaskMonitor's `.status` or `.value` fields.

async function implicitCancelChecking(tm: TaskMonitor) {
    tm.max = 1000;
    tm.throw_on_cancel();
    for (const i = 0; i < 1000; ++i) {
        await doSomething(i);
        ++tm.value; // May throw TaskCancelled if cancel() was called.
    }
}

// Currently, cancellation does not propagate automatically from parent to child
// tasks.  If such propagation is desired, it must be done manually.  (I made
// several attempts at automatic propagation, all of which had bugs or
// surprising behavior.)  There is not a great way to do manual propagation
// right now; if there turns out to be a need, I may revisit this later.

// [[EDITOR'S NOTE]] This odd use of multi-line comments makes it easier to edit
//      and type-check the examples above.  I need only comment out (ha) the
//      opening multi-line comment sigil at the beginning of the file to get my
//      editor to recognize the examples as live/valid TypeScript.

//***** END DOCUMENTATION AND CLEVER USE OF MULTI-LINE COMMENTS */



export interface TaskHandle {
    progress: Progress;
    cancel(): void;
}

export type Task<R> = Promise<R> & TaskHandle;
export type TaskIterator<R> = AsyncIterableIterator<R> & TaskHandle;

function _spawn<R>(
    parent: TaskMonitor | undefined,
    weight: number,
    fn: (tm: TaskMonitor) => Promise<R>,
): Task<R> {
    const tm = new TaskMonitor(parent, weight);
    const promise = fn(tm).finally(() => tm.detach());
    return Object.assign(promise, {
        progress: tm.progress,
        cancel() { tm.cancel(); },
    });
}

function _spawn_iter<R>(
    parent: TaskMonitor | undefined,
    weight: number,
    fn: (tm: TaskMonitor) => AsyncIterator<R>,
): TaskIterator<R> {
    let tm: TaskMonitor | undefined = new TaskMonitor(parent, weight);
    const iter = fn(tm);
    return {
        [Symbol.asyncIterator](): TaskIterator<R> { return this; },
        async next(): Promise<IteratorResult<R>> {
            const res = await iter.next();
            if (tm && res.done) {
                tm.detach();
                tm = undefined;
            }
            return res;
        },
        progress: tm!.progress,
        cancel() { tm?.cancel(); },
    };
}

export class TaskMonitor {
    readonly progress: Progress;

    private _cancel_throws: boolean = false;
    private _cancelled: boolean = false;

    static run<R>(fn: (tm: TaskMonitor) => Promise<R>): Task<R> {
        return _spawn(undefined, 1, fn);
    }

    static run_iter<R>(fn: (tm: TaskMonitor) => AsyncIterableIterator<R>):
        TaskIterator<R>
    {
        return _spawn_iter(undefined, 1, fn);
    }

    constructor(parent?: TaskMonitor, weight?: number) {
        this.progress = new Progress(parent?.progress, weight);
    }

    detach() { this.progress._detach(); }

    spawn<R>(fn: (tm: TaskMonitor) => Promise<R>): Task<R> {
        return this.wspawn(1, fn);
    }

    wspawn<R>(weight: number, fn: (tm: TaskMonitor) => Promise<R>): Task<R> {
        return _spawn(this, weight, fn);
    }

    spawn_iter<R>(fn: (tm: TaskMonitor) => AsyncIterableIterator<R>):
        TaskIterator<R>
    {
        return this.wspawn_iter(1, fn);
    }

    wspawn_iter<R>(
        weight: number,
        fn: (tm: TaskMonitor) => AsyncIterableIterator<R>
    ): TaskIterator<R> {
        return _spawn_iter(this, weight, fn);
    }

    get cancelled() { return this._cancelled; }
    cancel() { this._cancelled = true; }
    throw_on_cancel() { this._cancel_throws = true; }

    get status() { return this.progress.status; }
    set status(s: string) {
        this.progress.status = s;
        if (this._cancel_throws && this._cancelled) throw new TaskCancelled();
    }

    get value() { return this.progress.value; }
    set value(v: number) {
        this.progress.value = v;
        if (this._cancel_throws && this._cancelled) throw new TaskCancelled();
    }

    get max() { return this.progress.max; }
    set max(m: number) { this.progress.max = m; }
}

export class Progress {
    readonly id: string = '';
    status: string = '';

    private _value: number = 0;
    private _max: number = 1;

    private _children: Progress[] = [];
    private _subcount: number = 0;

    private _parent?: Progress;
    private _weight: number = 1;

    constructor(parent?: Progress, weight?: number) {
        if (parent) {
            this.id = `${parent.id}/${parent._subcount}`;
            if (weight && weight > 0) this._weight = weight;

            this._parent = parent;
            this._parent._subcount += 1;
            this._parent._children.push(this);
        }
    }

    get value() { return this._value; }
    get max() { return this._max; }
    get children(): Progress[] { return this._children; }

    set value(v: number) {
        if (v < 0) throw new RangeError("value must be >= 0");
        if (v > this._max) v = this._max;

        const old_value = this._value;
        this._value = v;
        this._updateParentProgress(old_value, this._max);
    }

    set max(m: number) {
        if (m <= 0) throw new RangeError("max must be > 0");

        const old_max = this._max;
        this._max = m;
        this._updateParentProgress(this._value, old_max);
    }

    _detach() {
        if (this._parent) {
            this._parent._children.splice(
                this._parent._children.indexOf(this), 1);
            this._parent = undefined;
        }
    }

    private _updateParentProgress(old_value: number, old_max: number) {
        if (this._parent) {
            const old_progress = this._weight * old_value / old_max;
            const new_progress = this._weight * this._value / this._max;
            this._parent.value += new_progress - old_progress;
        }
    }
}

export class TaskCancelled extends Error {}
