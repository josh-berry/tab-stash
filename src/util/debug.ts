/* c8 ignore start -- this is just a fancy console printer */

// Debug facilities for tracing various things at runtime, in production, with
// low overhead.

export type TracerFn = {
  (...args: any[]): void;
  readonly tag: string;
};

const tracers: Record<string, TracerFn> = {};
export const tracersEnabled: Record<string, boolean | "stack"> = {};

(<any>globalThis).trace = tracersEnabled;

/** Return a "tracer" function that just calls `console.log()`, but only if
 * `trace[tag]` is true.  Logs are always emitted prefixed with `[tag]`, so it's
 * possible to tell where the log is coming from.
 *
 * If `context` arguments are specified, those arguments are inserted into every
 * call to `console.log()`, after the `[tag]` but before the arguments to the
 * tracer function. */
export function trace_fn(tag: string, ...context: any[]): TracerFn {
  if (tracers[tag]) return tracers[tag];
  if (!(tag in tracersEnabled)) tracersEnabled[tag] = false;
  const log_tag = `[${tag}]`;

  const f =
    context.length > 0
      ? (...args: any[]) => {
          if (!tracersEnabled[tag]) return;
          console.log(log_tag, ...context, ...args);
          if (tracersEnabled[tag] === "stack") {
            try {
              throw new Error("stack trace");
            } catch (e) {
              console.log(e);
            }
          }
        }
      : (...args: any[]) => {
          if (!tracersEnabled[tag]) return;
          console.log(log_tag, ...args);
          if (tracersEnabled[tag] === "stack") {
            try {
              throw new Error("stack trace");
            } catch (e) {
              console.log(e);
            }
          }
        };
  (f as any).tag = tag;
  return f as TracerFn;
}
