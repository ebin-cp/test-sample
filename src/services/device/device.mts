import * as mariadb from "mariadb";
import type { Device } from "../../types/device.mjs";
import { ulid } from "ulid";

export class DeviceService {
    db_connection: mariadb.PoolConnection;
    constructor(db: mariadb.PoolConnection) {
        this.db_connection = db;
    }

    async get(imei?: string) {
        const getQuery = await this.db_connection.query(
            imei
                ? `SELECT imei,api_keys,tags,fields FROM devices WHERE imei=${imei}`
                : "SELECT imei,api_keys,tags,fields FROM devices",
        );

        return getQuery;
    }

    async create(imei: string) {
        const device: Device = {
            deviceId: ulid(),
            imei: imei,
            api_keys: { key: ulid(), created_at: Date.now() },
            tags: [{ key: "tag_1", value: "value_1" }],
            fields: [{ key: "tag_1", value: "value_1" }],
            created_at: Date.now(),
            modified_at: Date.now(),
        };

        const insertQuery = await this.db_connection.query(
            "INSERT INTO devices (deviceId, imei, api_keys,tags,fields,created_at,modified_at) VALUES (?,?,?,?,?,?,?)",
            [
                device.deviceId,
                device.imei,
                JSON.stringify(device.api_keys),
                JSON.stringify(device.tags),
                JSON.stringify(device.fields),
                device.created_at,
                device.modified_at,
            ],
        );

        return { result: `${insertQuery}`, key: device.api_keys };
    }

    async insert_volume_sensor_log(msg: string) { }
}
