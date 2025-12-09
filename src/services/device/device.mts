import * as mariadb from "mariadb";
import type { Device } from "../../types/device.mjs";
import { ulid } from "ulid";
import influx_line_protocol_parser from "../../utils/influx-line-protocol-parser.mjs";
import { InfluxLineParsed } from "../../types/message.mjs";

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
        const msg_to_json = await influx_line_protocol_parser(msg).catch(
            (err: {res:InfluxLineParsed[],err:Error}) => {
                return err;
            },
        );

        if (msg_to_json.err) {
            console.log(msg_to_json.err.message)
            return msg_to_json.err;
        }

        console.log(JSON.stringify(msg_to_json));

        const volume_data = msg_to_json.res.filter(
            (i) => i.measurement === "volume",
        )[0];
        console.log(JSON.stringify(volume_data));

        if (volume_data) {
            const imei = volume_data.tags.filter((i) => i.key === "imei")[0]?.value;
            console.log(imei);
            if (imei) {
                const insertQuery = await this.db_connection
                    .query(
                        "INSERT INTO device_volume_sensor_log (id, imei, measurement,tags,fields,timestamp) VALUES (?,?,?,?,?,?)",
                        [
                            ulid(),
                            imei,
                            volume_data.measurement,
                            JSON.stringify(volume_data.tags.filter((i) => i.key !== "imei")),
                            JSON.stringify(volume_data.fields),
                            volume_data.timestamp,
                        ],
                    )
                    .catch((err) => {
                        console.log(err);
                    });

                console.log(insertQuery);

                return { result: `${insertQuery}` };
            }
        }
        return { result: " " };
    }

    async get_volume_sensor_log(imei: string) {
        const getQuery = await this.db_connection.query(
            `SELECT imei,measurement,tags,fields,timestamp FROM devices_volume_sensor_log WHERE imei=${imei} ORDER BY timestamp DESC LIMIT 1000`,
        );

        return getQuery;
    }
}
