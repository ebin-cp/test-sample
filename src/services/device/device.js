import { ulid } from "ulid";
import influx_line_protocol_parser from "../../utils/influx-line-protocol-parser.js";
export class DeviceService {
    dbConnection;
    constructor(db) {
        this.dbConnection = db;
    }
    async get(imei) {
        const rows = imei
            ? await this.dbConnection.execute("SELECT imei,api_keys,presence FROM devices WHERE imei=?", [imei])
            : await this.dbConnection.execute("SELECT imei,api_keys,presence FROM devices");
        return rows;
    }
    async create(imei) {
        const device = {
            deviceId: ulid(),
            imei: imei,
            api_keys: { key: ulid(), created_at: Date.now() },
            tags: [{ key: "truck_id", value: "000000" }],
            fields: [{ key: "field_01", value: "value_01" }],
            presence: `disconnected ${Date.now()}`,
            created_at: Date.now(),
            modified_at: Date.now(),
        };
        const res = await this.dbConnection.execute("INSERT INTO devices (deviceId, imei, api_keys,tags,fields,presence,created_at,modified_at) VALUES (?,?,?,?,?,?,?,?)", [
            device.deviceId,
            device.imei,
            JSON.stringify(device.api_keys),
            JSON.stringify(device.tags),
            JSON.stringify(device.fields),
            device.presence,
            device.created_at,
            device.modified_at,
        ]);
        if (res.affectedRows > 0) {
            return { result: "Success", key: device.api_keys };
        }
        return { result: "Failure" };
    }
    async insertMonitorLog(msg) {
        const msgToJson = await influx_line_protocol_parser(msg).catch((err) => {
            return err;
        });
        if (msgToJson.err) {
            console.log(msgToJson.err.message);
            return msgToJson.err;
        }
        const msgToInsert = [];
        for (const log_item of msgToJson.res) {
            const imei = log_item.tags.filter((i) => i.key === "imei")[0]?.value;
            if (imei) {
                msgToInsert.push([
                    ulid(),
                    imei,
                    log_item.measurement,
                    JSON.stringify(log_item.tags.filter((i) => i.key !== "imei")),
                    JSON.stringify(log_item.fields),
                    log_item.timestamp,
                ]);
            }
        }
        const res = await this.dbConnection.batch("INSERT INTO device_monitor_log (id, imei, measurement,tags,fields,timestamp) VALUES (?,?,?,?,?,?)", msgToInsert);
        for (const r of res) {
            console.log(`${r.affectedRows < 0 ? "Failed" : "Successful"} measurement insert`);
        }
        return { result: " " };
    }
    async getMonitorLog(imei, measurement, timeperiod) {
        const rows = await this.dbConnection.execute(`SELECT imei,measurement,tags,fields,DATE_FORMAT(FROM_UNIXTIME(timestamp / 1000000000), '%Y-%m-%dT%T.%f') AS iso_time FROM device_monitor_log WHERE imei=? AND measurement=? AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC LIMIT 1000`, [imei, measurement, ...timeperiod]);
        return rows;
    }
    async devicePresence(imei, event) {
        const updateQuery = await this.dbConnection.execute("UPDATE devices SET presence = CONCAT(?,' ', UNIX_TIMESTAMP() * 1000) WHERE imei = ?", [event, imei]);
        return updateQuery;
    }
}
