import { ulid } from "ulid";
import influx_line_protocol_parser from "../../utils/influx-line-protocol-parser.js";
import { TRUCK_INFO_INPUT_SCHEMA, DEVICE_FIRMWARE_INPUT_SCHEMA } from "../../types/device.js";
import z from "zod";
import {
    deassignTruck,
    deviceExistence,
    deviceInsertion,
    deviceMonitorLogInsertion,
    deviceMonitorLogQuery,
    getDeviceFields,
    getDevices,
    getOneDevice,
    insertDeviceFields,
    truckInfoElementIndex,
    truckInfoValueExistence,
    updateDevicePresence,
    updateDeviceFields,
} from "./queries.js";
import logfmt from "../../utils/logfmt.js";

const measurementBuffer = [];

export class DeviceService {
    constructor(pool) {
        this.connectionPool = pool;
        this.measurementBuffer = [];
        this.flushMeasurementrLog();
        this.currentTimer = null;
        this.isShuttingDown = false;
        this.isSyncing = false;
    }
    async get(imei) {
        const query = imei ? getOneDevice : getDevices;
        const params = imei ? [imei] : [];
        const rows = await this.connectionPool
            .execute(query, params)
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

        const deviceExistenceValidate = await this.connectionPool.query(
            deviceExistence,
            [imei],
        );

        if (Number(deviceExistenceValidate[0].count)) {
            return {
                code: 400,
                reason: "Device already exists",
            };
        }
        const res = await this.connectionPool
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

    async bufferMeasurementLog(msg, imei) {
        const msgToJson = await influx_line_protocol_parser(msg).catch((err) => {
            return { error: err };
        });
        if (msgToJson.error) {
            return {
                code: msgToJson.error.err.message.startsWith("Error decoding")
                    ? 400
                    : 500,
                reason: msgToJson.error.err.message.startsWith("Error decoding")
                    ? "ERROR:INVALID_MEASUREMENT:400"
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
        for (const log_item of msgToJson.res) {
            const measurementRegex = /(volume|cellular|firmware|battery)/;
            if (imei && measurementRegex.test(log_item.measurement)) {
                const stripImei = log_item.tags.filter((i) => i.key !== "imei");
                const tagsWithoutImei = stripImei ? stripImei : [];
                this.measurementBuffer.push([
                    imei,
                    log_item.measurement,
                    JSON.stringify(tagsWithoutImei),
                    JSON.stringify(log_item.fields),
                    log_item.timestamp,
                    JSON.stringify(tagsWithoutImei),
                    JSON.stringify(log_item.fields),
                ]);
            }
        }
        logfmt("info", {
            event: "Buffer Measurement Service",
            buffer_length: measurementBuffer.length,
        });
        return {
            code: 200,
            res: "Message added to buffer",
        };
    }
    async flushMeasurementrLog() {
        if (this.isShuttingDown || this.isSyncing) return;
        const dataToWrite = this.measurementBuffer.splice(
            0,
            this.measurementBuffer.length,
        );

        if (dataToWrite.length === 0) {
            this.currentTimer = setTimeout(() => this.flushMeasurementrLog(), 1000);
            return;
        }

        logfmt("info", {
            event: "Flush Measurement Service",
            msg: "Buffer length before flushing",
            buffer_length: dataToWrite.length,
        });

        logfmt("info", {
            event: "Flush Measurement Service",
            msg: "Waiting to flush buffer to database..",
        });

        this.isSyncing = true;
        await this.connectionPool
            .batch(deviceMonitorLogInsertion, dataToWrite)
            .then(() => {
                logfmt("info", {
                    event: "Flush Measurement Service",
                    msg: `Flushed ${dataToWrite.length} metrics.`,
                });
            })
            .catch((err) => {
                logfmt("error", {
                    event: "Flush Measurement Service",
                    msg: `Failed to flush ${dataToWrite.length} metrics.`,
                    error: err,
                });
                this.measurementBuffer.unshift(...dataToWrite);
                logfmt("info", {
                    event: "Flush Measurement Service",
                    msg: "Buffer length after flushing",
                    buffer_length: dataToWrite.length,
                });
                return {
                    error: err,
                };
            })
            .finally(() => {
                this.isSyncing = false;
                if (!this.isShuttingDown) {
                    if (this.measurementBuffer.length > 1000) {
                        logfmt("info", {
                            event: "Flush Measurement Service",
                            msg: `Instant flush batch of ${this.measurementBuffer.length} metrics.`,
                        });
                        setImmediate(() => this.flushMeasurementrLog());
                    } else {
                        this.currentTimer = setTimeout(
                            () => this.flushMeasurementrLog(),
                            1000,
                        );
                    }
                }
            });
    }

    async shutdown() {
        this.isShuttingDown = true;

        if (this.currentTimer) {
            clearTimeout(this.currentTimer);
        }

        logfmt("info", {
            event: "Flush Measurement Service",
            msg: `Shutting down. Flushing ${this.measurementBuffer.length} remaining messages...`,
        });

        if (this.measurementBuffer.length > 0) {
            await this.flushManual();
        }

        logfmt("info", {
            event: "Flush Measurement Service",
            msg: "Flush Complete.",
        });
    }

    async flushManual() {
        const dataToWrite = this.measurementBuffer.splice(
            0,
            this.measurementBuffer.length,
        );
        await this.connectionPool
            .batch(deviceMonitorLogInsertion, dataToWrite)
            .then(() => {
                logfmt("info", {
                    event: "Flush Measurement Service",
                    msg: `Flushed final batch of ${dataToWrite.length} metrics.`,
                });
            })
            .catch((err) => {
                logfmt("info", {
                    event: "Flush Measurement Service",
                    msg: `Failed to flush final batch of ${dataToWrite.length} metrics.`,
                });
            });
    }

    async getMeasurementLog(imei, measurement, timeperiod) {
        const rows = await this.connectionPool
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
        const updateQuery = await this.connectionPool
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

        const deviceExistenceValidate = await this.connectionPool.query(
            deviceExistence,
            [imei],
        );

        if (!Number(deviceExistenceValidate[0].count)) {
            return {
                code: 400,
                reason: "Device Not Found",
            };
        }

        const duplicateValidation = await this.connectionPool.query(
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
            const searchRes = await this.connectionPool
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
                query = updateDeviceFields;
                params = [indexPath, key, value, Date.now(), imei];
            } else {
                query = insertDeviceFields;
                params = [key, value, Date.now(), imei];
            }

            const updateRes = await this.connectionPool
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
        const deviceExistenceValidate = await this.connectionPool.query(
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
            const updateQuery = await this.connectionPool.execute(deassignTruck, [
                i,
                imei,
            ]);
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

    async setFirmwareUrl(fw_url, imei) {
        const validate = DEVICE_FIRMWARE_INPUT_SCHEMA.safeParse(fw_url);
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

        const deviceExistenceValidate = await this.connectionPool.query(
            deviceExistence,
            [imei],
        );

        if (!Number(deviceExistenceValidate[0].count)) {
            return {
                code: 400,
                reason: "Device Not Found",
            };
        }

        for (const { key, value } of insertInfo) {
            const searchRes = await this.connectionPool
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
                query = updateDeviceFields;
                params = [indexPath, key, value, Date.now(), imei];
            } else {
                query = insertDeviceFields;
                params = [key, value, Date.now(), imei];
            }

            const updateRes = await this.connectionPool
                .query(query, params)
                .catch((err) => ({ error: err }));

            if (updateRes.error) {
                return { code: 500, reason: updateRes.error.message };
            }
        }

        return { code: 200, res: "Success" };
    }

    async deviceDirective(imei, directiveMsg) {
        const res = { code: 400 };
        switch (directiveMsg.message) {
            case "SYNC:CALIBRATION:volume": {
                const getQuery = await this.connectionPool
                    .execute(getDeviceFields, [
                        "truck_tank_volume_mapping",
                        imei,
                    ])
                    .catch((err) => {
                        return { error: err };
                    });

                if (getQuery.error || !getQuery[0].dev_field) {
                    logfmt("error", {
                        event: "Device Directive Service",
                        msg: getQuery,
                    });
                    res.reason = "NOT_FOUND:CALIBRATION:volume";
                    res.code = 500;
                    break;
                }
                if (getQuery[0].dev_field.length > 1) {
                    res.code = 200;
                    res.res = `${directiveMsg.message}\n${getQuery[0].dev_field}`;
                    break;
                }
                res.reason = "NOT_FOUND:CALIBRATION:volume";
                res.code = 500;
                break;
            }
            case "GET:FIRMWARE:latest": {
                const getQuery = await this.connectionPool
                    .execute(getDeviceFields, [
                        "firmware_url",
                        imei,
                    ])
                    .catch((err) => {
                        return { error: err };
                    });

                if (getQuery.error || !getQuery[0].dev_field) {
                    logfmt("error", {
                        event: "Device Directive Service",
                        msg: getQuery,
                    });
                    res.reason = "NOT_FOUND:FIRMWARE:latest";
                    res.code = 500;
                    break;
                }
                if (getQuery[0].dev_field.length > 1) {
                    res.code = 200;
                    res.res = `${directiveMsg.message}\n${getQuery[0].dev_field}`;
                    break;
                }
                res.reason = "NOT_FOUND:FIRMWARE:latest";
                res.code = 500;
                break;
            }
            default: {
                break;
            }
        }
        return res;
    }
}
