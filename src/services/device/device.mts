import * as mariadb from "mariadb";
import type { Device } from "../../types/device.mjs";
import { ulid } from "ulid";
import { influx_line_protocol_parser } from "../../utils/influx-line-protocol-parser.mjs";

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

    async insert_volume_sensor_log(msg: string) {
        const msg_to_json = influx_line_protocol_parser(msg);

        if (msg_to_json.error) {
            return msg_to_json;
        }

        const insertQuery = await this.db_connection.query(
            "INSERT INTO device_volume_sensor_log (id, imei, measurement,tags,fields,timestamp) VALUES (?,?,?,?,?,?)",
            [
                ulid(),
                msg_to_json.imei,
                msg_to_json.measurement,
                JSON.stringify(msg_to_json.tags),
                JSON.stringify(msg_to_json.fields),
                msg_to_json.timestamp,
            ],
        ).catch((err)=>{
            console.log(err)
            });

        console.log(insertQuery)

        return { result: `${insertQuery}` };
    }

    async get_volume_sensor_log(imei: string) {
        const getQuery = await this.db_connection.query(
            `SELECT imei,measurement,tags,fields,timestamp FROM devices_volume_sensor_log WHERE imei=${imei} ORDER BY timestamp DESC LIMIT 1000`,
        );

        return getQuery;
    }
}
