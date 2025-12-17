import * as mariadb from "mariadb";
import type { Device } from "../../types/device.mjs";
import { ulid } from "ulid";
import influx_line_protocol_parser from "../../utils/influx-line-protocol-parser.mjs";
import type { InfluxLineParsed } from "../../types/message.mjs";

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

    async insert_monitorlog(msg: string) {
        const msg_to_json = await influx_line_protocol_parser(msg).catch(
            (err: { res: InfluxLineParsed[]; err: Error }) => {
                return err;
            },
        );

        if (msg_to_json.err) {
            console.log(msg_to_json.err.message);
            return msg_to_json.err;
        }

        console.log(JSON.stringify(msg_to_json));

        console.log(JSON.stringify(msg_to_json.res));

        for (const log_item of msg_to_json.res) {
            const imei = log_item.tags.filter((i) => i.key === "imei")[0]?.value;
            console.log(imei);
            if (imei) {
                const insertQuery = await this.db_connection
                    .query(
                        "INSERT INTO device_monitor_log (id, imei, measurement,tags,fields,timestamp) VALUES (?,?,?,?,?,?)",
                        [
                            ulid(),
                            imei,
                            log_item.measurement,
                            JSON.stringify(log_item.tags.filter((i) => i.key !== "imei")),
                            JSON.stringify(log_item.fields),
                            log_item.timestamp,
                        ],
                    )
                    .catch((err) => {
                        console.log(err);
                    });

                console.log(insertQuery);
            }
        }
        return { result: " " };
    }

    async get_monitorlog(
        imei: string,
        measurement: string,
        timeperiod: string[],
    ) {
        const getQuery = await this.db_connection.query(
            `SELECT imei,measurement,tags,fields,DATE_FORMAT(FROM_UNIXTIME(timestamp / 1000000000), '%Y-%m-%dT%T.%f') AS iso_time FROM device_monitor_log WHERE imei='${imei}' AND measurement='${measurement}' AND timestamp BETWEEN ${timeperiod[0]} AND ${timeperiod[1]} ORDER BY timestamp ASC LIMIT 1000`,
        );

        return getQuery;
    }
}
