import { ulid } from "ulid";
import influx_line_protocol_parser from "../../utils/influx-line-protocol-parser.js";
import { TRUCK_INFO_INPUT_SCHEMA } from "../../types/device.js";
import z from "zod";
import {
    deassignTruck,
    deviceExistence,
    deviceInsertion,
    deviceMonitorLogInsertion,
    deviceMonitorLogQuery,
    getDevices,
    getDeviceTankVolumeCalibration,
    getOneDevice,
    insertTruckFields,
    truckInfoElementIndex,
    truckInfoValueExistence,
    updateDevicePresence,
    updateTruckFields,
} from "./queries.js";

export class DeviceService {
    dbConnection;
    constructor(db) {
        this.dbConnection = db;
    }

    async get(imei) {
        const query = imei ? getOneDevice : getDevices;
        const params = imei ? [imei] : [];
        const rows = await this.dbConnection.execute(query, params).catch((err) => {
            return {
                error: err,
            };
        });

        if (rows.error) {
            return { code: 500, reason: rows.error.message };
        }

        return { code: 200, res: rows };
    }

    async create(imei) {
        const device = {
            deviceId: ulid(),
            imei: imei,
            api_keys: { key: ulid(), created_at: Date.now() },
            fields: [],
            presence: `disconnected ${Date.now()}`,
            created_at: Date.now(),
            modified_at: Date.now(),
        };
        const res = await this.dbConnection
            .execute(deviceInsertion, [
                device.deviceId,
                device.imei,
                JSON.stringify(device.api_keys),
                JSON.stringify(device.fields),
                device.presence,
                device.created_at,
                device.modified_at,
            ])
            .catch((err) => {
                return {
                    error: err,
                };
            });
        if (res.error) {
            return { code: 500, reason: res.error.message };
        }
        if (res.affectedRows > 0) {
            return { code: 200, res: device.api_keys };
        }
        return { code: 500 };
    }

    async insertMonitorLog(msg, imei) {
        const msgToJson = await influx_line_protocol_parser(msg).catch((err) => {
            return { error: err };
        });
        if (msgToJson.error) {
            return {
                code: msgToJson.error.err.message.startsWith("Error decoding")
                    ? 400
                    : 500,
                reason: msgToJson.error.err.message.startsWith("Error decoding")
                    ? "ERROR:INVALID_MESSAGE:400"
                    : "ERROR:INFLUX_LINE_PROTOCOL_PARSER:500",
            };
        }
        const recieved_imei = msgToJson.res[0].tags.filter(
            (i) => i.key === "imei",
        )[0]?.value;
        if (!/^\d{15,16}$/.test(recieved_imei)) {
            return { code: 400, reason: "ERROR:INVALID_IMEI:400" };
        }
        if (!recieved_imei) {
            return { code: 400, reason: "ERROR:IMEI_MISSING:400" };
        }
        if (recieved_imei !== imei) {
            return { code: 400, reason: "ERROR:IMEI_MISMATCH:400" };
        }
        const msgToInsert = [];
        for (const log_item of msgToJson.res) {
            const measurementRegex = /(volume|cellular|firmware|battery)/;
            if (imei && measurementRegex.test(log_item.measurement)) {
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
        const res = await this.dbConnection
            .batch(deviceMonitorLogInsertion, msgToInsert)
            .catch((err) => {
                return {
                    error: err,
                };
            });
        if (res.error) {
            return { code: 500, reason: res.error.message };
        }

        const funcRes = [];
        for (const r of res) {
            funcRes.push(r.affectedRows < 0 ? 500 : 200);
        }
        return {
            code: funcRes.includes(500) ? 500 : 200,
            res: funcRes.includes(500) ? undefined : "Success",
            reason: funcRes.includes(500)
                ? "Failed to insert to database"
                : undefined,
        };
    }

    async getMonitorLog(imei, measurement, timeperiod) {
        const rows = await this.dbConnection
            .execute(deviceMonitorLogQuery, [imei, measurement, ...timeperiod])
            .catch((err) => {
                return {
                    error: err,
                };
            });

        if (rows.error) {
            return { code: 500, reason: rows.error.message };
        }

        return { code: 200, res: rows };
    }

    async devicePresence(imei, event) {
        const updateQuery = await this.dbConnection
            .execute(updateDevicePresence, [event, imei])
            .catch((err) => {
                return {
                    error: err,
                };
            });
        if (updateQuery.error) {
            return { code: 500, reason: updateQuery.error.message };
        }

        if (updateQuery.affectedRows > 0) {
            return { code: 200 };
        }
        return { code: 500, reason: updateQuery.info };
    }

    async assignTruck(truckinfo, imei) {
        const validate = TRUCK_INFO_INPUT_SCHEMA.safeParse(truckinfo);
        if (validate.error) {
            return { code: 400, reason: z.treeifyError(validate.error) };
        }
        const insertInfo = [];
        for (const k of Object.keys(validate.data)) {
            insertInfo.push({
                key: k,
                value: validate.data[k],
                modified_at: Date.now(),
            });
        }

        const deviceExistenceValidate = await this.dbConnection.query(
            deviceExistence,
            [imei],
        );

        if (!Number(deviceExistenceValidate[0].count)) {
            return {
                code: 400,
                reason: "Device Not Found",
            };
        }

        const duplicateValidation = await this.dbConnection.query(
            truckInfoValueExistence,
            ["truck_reg_no", validate.data.truck_reg_no, imei],
        );

        if (Number(duplicateValidation[0].count)) {
            return {
                code: 400,
                reason: "A Device is already assigned to this truck",
            };
        }

        for (const { key, value } of insertInfo) {
            const searchRes = await this.dbConnection
                .query(truckInfoElementIndex, [key, key, imei])
                .catch((err) => ({ error: err }));

            if (searchRes.error) {
                conn.release();
                return { code: 500, reason: searchRes.error.message };
            }

            const path = searchRes[0]?.path;
            let query = "";
            let params = [];

            if (path) {
                const indexPath = path.replace(".key", "");
                query = updateTruckFields;
                params = [indexPath, key, value, Date.now(), imei];
            } else {
                query = insertTruckFields;
                params = [key, value, Date.now(), imei];
            }

            const updateRes = await this.dbConnection
                .query(query, params)
                .catch((err) => ({ error: err }));

            if (updateRes.error) {
                return { code: 500, reason: updateRes.error.message };
            }
        }

        return { code: 200, res: "Success" };
    }

    async deassignTruck(imei) {
        const keys = [
            "truck_reg_no",
            "truck_tank_volume",
            "truck_tank_volume_mapping",
        ];
        const deviceExistenceValidate = await this.dbConnection.query(
            deviceExistence,
            [imei],
        );

        if (!Number(deviceExistenceValidate[0].count)) {
            return {
                code: 400,
                reason: "Device Not Found",
            };
        }

        const results = { code: 400 };
        const dbResults = [];
        for (const i of keys) {
            const updateQuery = await this.dbConnection.execute(deassignTruck, [
                i,
                imei,
            ]);
            console.log(updateQuery);
            if (updateQuery.affectedRows > 0) {
                dbResults.push({ code: 200 });
            } else {
                dbResults.push({ code: 500, reason: updateQuery.info });
            }
        }
        if (dbResults.includes(500)) {
            results.code = 500;
            results.reason = JSON.stringify(dbResults);
        } else {
            results.code = 200;
            results.res = "Success";
        }
        return results;
    }

    async deviceDirective(imei, directiveMsg) {
        const res = { code: 400 };
        switch (directiveMsg.message) {
            case "SYNC:CALIBRATION:volume": {
                const getQuery = await this.dbConnection
                    .execute(getDeviceTankVolumeCalibration, [
                        "truck_tank_volume_mapping",
                        imei,
                    ])
                    .catch((err) => {
                        return { error: err };
                    });

                if (getQuery.error || !getQuery[0].volume_map) {
                    console.error(getQuery.error ? getQuery.error : getQuery);
                    res.reason = "NOT_FOUND:CALIBRATION:volume";
                    res.code = 500;
                    break;
                }
                if (getQuery[0].volume_map.length > 1) {
                    res.code = 200;
                    res.res = getQuery[0].volume_map;
                    break;
                }
                res.reason = "NOT_FOUND:CALIBRATION:volume";
                res.code = 500;
                break;
            }
            case "GET:FIRMWARE:latest": {
                res.code = 200;
                res.res = "";
                break;
            }
            default: {
                break;
            }
        }
        return res;
    }
}
