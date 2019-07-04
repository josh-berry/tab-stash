import {expect} from 'chai';

export class MockEventDispatcher<Fn extends Function> {
    _listeners: Fn[] = [];
    _pending: any[] = [];
    _imm: any;
    _drained: number = 0;

    addListener(l: Fn) {
        expect(l).to.be.a('function');
        this._listeners.push(l);
    }

    send(...args: any[]) {
        this._pending.push(args);
        if (! this._imm) this._imm = setImmediate(() => this._drain());
    }

    drain(): Promise<number> {
        return new Promise(resolve => {
            setImmediate(() => {
                this._drain();
                resolve(this._drained);
                this._drained = 0;
            });
        });
    }

    _drain() {
        this._imm = undefined;

        let p = this._pending;
        this._pending = [];

        for (let ev of p) for (let f of this._listeners) f(...ev);
        this._drained += p.length;
    }
}
