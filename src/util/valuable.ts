export type MaybeValuable
    <
        T extends
        string | number | boolean |
        Record<string, any> |
        any[]
    > = T | null | undefined;

export class Valuable<T> {
    private readonly value: T | undefined;
    public constructor(mv: MaybeValuable<T>, picky = true) {
        this.value = Valuable.extract(mv, picky);
    }

    public isValuable(): boolean {
        return this.value !== undefined;
    }

    public with(f: (_val: T) => T): T | undefined {
        return this.value === undefined ? undefined : f(this.value);
    }

    public chain(fs: ((_val: T) => T | undefined | null)[]): T | undefined {
        let value = this.value;
        for (const f of fs) {
            if (value === undefined) return undefined;
            value = f(value) ?? undefined;
        }
        return value;
    }

    public map<OUT>(f: (_val: T) => OUT): OUT | undefined {
        return this.value === undefined ? undefined : f(this.value);
    }

    public get(): T | undefined {
        return this.value;
    }

    /** Extracts a non-null, "valid" value.
 *  Rules:
 *   null or undefined always results in undefined.
 *   otherwise the result is based on type:
 *    string: non-empty value OR undefined
 *    number: non-NaN value OR undefined
 *    object: always returns value
 *    array: always returns value
  */
    public static extract<T>(mv: MaybeValuable<T>, picky = true): T | undefined {
        if (!picky && mv !== null) return mv;
        if (mv === undefined || mv === null)
            return undefined;
        switch (typeof mv) {
            case 'string': return mv !== '' ? mv : undefined;
            case 'boolean': return mv === true ? mv : undefined;
            case 'number': return !isNaN(mv) ? mv : undefined;
            // fallthrough:
            // non-null, non-undefined object always is true.
            // non-null, non-undefined array always is true.
            default: return mv;
        }
    }

    public static yes<T>(mv: MaybeValuable<T>): mv is T {
       return Valuable.extract(mv) !== undefined;
    }

    public static no<T>(mv: MaybeValuable<T>): mv is Exclude<typeof mv, T> {
       return Valuable.extract(mv) === undefined;
    }

}

export function valuable<T>(mv: MaybeValuable <T>, picky = true): Valuable <T> {
    return new Valuable(mv, picky);
}
