import type {EventSource} from "./event";

export type EventWiringOptions = {
  onFired(): void;
  onError(e: unknown): void;
};

export class EventWiring<M> {
  readonly model: M;
  readonly options: EventWiringOptions;

  constructor(model: M, options: EventWiringOptions) {
    this.model = model;
    this.options = options;
  }

  listen<A extends any[], R>(
    ev: EventSource<(...args: A) => R>,
    fn: (this: M, ...args: A) => R,
  ): (...args: A) => R {
    // CAST: Work around https://github.com/microsoft/TypeScript/issues/42700
    const f: (...args: A) => R = fn.bind(this.model as any);

    const handler = (...args: A) => {
      try {
        this.options.onFired();
        return f(...args);
      } catch (e) /* istanbul ignore next */ {
        // This is a safety net; unhandled exceptions generally should
        // not happen inside event handlers.
        this.options.onError(e);
        throw e;
      }
    };

    ev.addListener(handler);
    return handler;
  }
}
