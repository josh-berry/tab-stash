import {KeyValueStore, genericList} from '.';
import * as Proto from './proto';
import {connect} from '../../util/nanoservice';
import event, {Event} from '../../util/event';

export default class Client<K extends Proto.Key, V extends Proto.Value>
    implements KeyValueStore<K, V>
{
    readonly onSet: Event<(entries: Proto.Entry<K, V>[]) => void>;
    readonly onDelete: Event<(keys: K[]) => void>;

    private _port: Proto.ServicePort<K, V>;

    constructor(name_or_port: string | Proto.ServicePort<K, V>) {
        let name;
        let port: Proto.ServicePort<K, V>;
        // istanbul ignore next
        if (typeof name_or_port === 'string') {
            name = name_or_port;
            port = connect(name_or_port);
        } else {
            name = name_or_port.name;
            port = name_or_port;
        }

        this.onSet = event('KVS.Client.onSet', name);
        this.onDelete = event('KVS.Client.onDelete', name);

        this._port = port;
        this._port.onNotify = msg => {
            /* istanbul ignore next */ if (! msg) return;
            switch (msg.$type) {
                case 'delete':
                    this.onDelete.send(msg.keys);
                    break;
                case 'set':
                    this.onSet.send(msg.entries);
                    break;
            }
        };
    }

    async get(keys: K[]): Promise<Proto.Entry<K, V>[]> {
        const resp = await this._port.request({$type: 'get', keys});
        // istanbul ignore next
        if (resp?.$type !== 'set') return [];
        return resp.entries;
    }

    async getStartingFrom(
        bound: K | undefined, limit: number
    ): Promise<Proto.Entry<K, V>[]> {
        const resp = await this._port.request({
            $type: 'getStartingFrom', bound, limit});
        // istanbul ignore next
        if (resp?.$type !== 'set') return [];
        return resp.entries;
    }

    async getEndingAt(
        bound: K | undefined, limit: number
    ): Promise<Proto.Entry<K, V>[]> {
        const resp = await this._port.request({
            $type: 'getEndingAt', bound, limit});
        // istanbul ignore next
        if (resp?.$type !== 'set') return [];
        return resp.entries;
    }

    list(): AsyncIterable<Proto.Entry<K, V>> {
        return genericList((bound, limit) => this.getStartingFrom(bound, limit));
    }

    listReverse(): AsyncIterable<Proto.Entry<K, V>> {
        return genericList((bound, limit) => this.getEndingAt(bound, limit));
    }

    async set(entries: Proto.Entry<K, V>[]): Promise<void> {
        await this._port.request({$type: 'set', entries: entries});
    }

    async delete(keys: K[]): Promise<void> {
        await this._port.request({$type: 'delete', keys});
    }

    async deleteAll(): Promise<void> {
        await this._port.request({$type: 'deleteAll'});
    }
}
