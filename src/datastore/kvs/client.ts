import {KeyValueStore, genericList} from '.';
import * as Proto from './proto';
import * as NanoService from '../../util/nanoservice';
import event, {Event} from '../../util/event';

export default class Client<K extends Proto.Key, V extends Proto.Value>
    implements KeyValueStore<K, V>
{
    readonly name: string;

    readonly onSet: Event<(entries: Proto.Entry<K, V>[]) => void>;
    readonly onDelete: Event<(keys: K[]) => void>;
    readonly onSyncLost: Event<() => void>;

    private _port: Proto.ServicePort<K, V>;

    constructor(
        service_name: string,
        connector?: (name: string) => Proto.ServicePort<K, V>)
    {
        // istanbul ignore next -- we always pass `connector` for tests
        const connect = connector ?? NanoService.connect;

        this.name = service_name;
        this._port = connect(service_name);

        this.onSet = event('KVS.Client.onSet', this.name);
        this.onDelete = event('KVS.Client.onDelete', this.name);
        this.onSyncLost = event('KVS.Client.onSyncLost', this.name);

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

        this._port.onDisconnect = () => {
            this._port = connect(service_name);
            this.onSyncLost.send();
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
