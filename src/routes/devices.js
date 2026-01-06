import { DeviceService } from "../services/device/device.js";
import getRequestBody from "../utils/get-request-body.js";
import dbConnection from "../services/db-connection/db-connection.js";
import { DEVICE_SCHEMA } from "../types/device.js";
async function deviceRoutes(req, ws_msg) {
    const url_parsed = new URL(
        `http://${process.env.HOST ?? "localhost"}${req.url}`,
    );
    const routeKey = ws_msg
        ? ws_msg.event
        : `${req.method} ${url_parsed.pathname}`;
    const connection = await dbConnection();
    const [client_imei, client_api] = ws_msg
        ? req.headers.authorization.split(" ")
        : ["", ""];
    const devices = new DeviceService(connection);
    const response = {
        statusCode: 403,
        body: JSON.stringify({ error: "Invalid" }),
    };
    if (!url_parsed) {
        console.log("Request URL error", url_parsed);
        return response;
    }
    switch (routeKey) {
        case "GET /api/v1/device": {
            const imei = url_parsed.searchParams.get("imei");
            const readReq = await devices.get(imei).catch((err) => {
                return {
                    error: err,
                };
            });
            if (readReq.error) {
                response.statusCode = 500;
                break;
            }

            response.statusCode = readReq.code ? readReq.code : 500;
            response.body =
                response.statusCode === 200
                    ? JSON.stringify(readReq.res)
                    : JSON.stringify(readReq.reason);
            break;
        }
        case "POST /api/v1/device": {
            const reqBody = await getRequestBody(req);
            const reqBodyJson = JSON.parse(reqBody);
            const validateImei = DEVICE_SCHEMA.shape.imei.safeParse(reqBodyJson.imei);
            if (validateImei.error) {
                response.statusCode = 400;
                response.body = "Invalid IMEI. Should be a 15 or 16 digit number";
                break;
            }
            const createReq = await devices.create(reqBodyJson.imei).catch((err) => {
                return {
                    error: err,
                };
            });
            if (createReq.error) {
                response.statusCode = 500;
                break;
            }

            response.statusCode = createReq.code ? createReq.code : 500;
            response.body =
                response.statusCode === 200
                    ? JSON.stringify(createReq.res)
                    : JSON.stringify(createReq.reason);
            break;
        }
        case "PUT /api/v1/device/assign-truck": {
            const reqBody = await getRequestBody(req);
            const reqBodyJson = JSON.parse(reqBody);
            const imei = url_parsed.searchParams.get("imei");
            const assignReq = await devices
                .assignTruck(reqBodyJson, imei)
                .then((res) => {
                    console.log(res);
                    return res;
                });
            if (assignReq.error) {
                response.statusCode = 500;
                break;
            }
            response.statusCode = assignReq.code ? assignReq.code : 500;
            response.body =
                response.statusCode === 200
                    ? JSON.stringify(assignReq.res)
                    : JSON.stringify(assignReq.reason);
            break;
        }
        case "PUT /api/v1/device/deassign-truck": {
            const imei = url_parsed.searchParams.get("imei");
            const deassignReq = await devices.deassignTruck(imei).then((res) => {
                console.log(res);
                return res;
            });
            if (deassignReq.error) {
                response.statusCode = 500;
                break;
            }
            response.statusCode = deassignReq.code ? deassignReq.code : 500;
            response.body =
                response.statusCode === 200
                    ? JSON.stringify(deassignReq.res)
                    : JSON.stringify(deassignReq.reason);
            break;
        }
        case "GET /api/v1/device/measurements": {
            const imei = url_parsed.searchParams.get("imei");
            const measurement = url_parsed.searchParams.get("measurement");
            const timeperiod = [
                url_parsed.searchParams.get("start_ns"),
                url_parsed.searchParams.get("end_ns"),
            ].flatMap((ele) => (ele === null ? [] : [ele]));
            if (!imei || !measurement || !timeperiod[0] || !timeperiod[1]) {
                response.statusCode = 400;
                break;
            }
            if (Number(timeperiod[0]) > Date.now() * 1000000) {
                response.statusCode = 400;
                break;
            }
            const readReq = await devices
                .getMonitorLog(imei, measurement, timeperiod)
                .catch((err) => {
                    return { error: err };
                });
            if (readReq.error) {
                response.statusCode = 500;
                break;
            }
            response.statusCode = readReq.code ? readReq.code : 500;
            response.body =
                response.statusCode === 200
                    ? JSON.stringify(readReq.res)
                    : JSON.stringify(readReq.reason);
            break;
        }
        case "ws_presence_msg": {
            if (ws_msg) {
                const [imei, event] = ws_msg.message.split(" ");
                if (!imei || !event) {
                    response.statusCode = 400;
                    break;
                }
                const presenceRes = await devices
                    .devicePresence(imei, event)
                    .catch((err) => {
                        response.statusCode = 500;
                        console.error(err);
                    });
                if (presenceRes.error) {
                    response.statusCode = 500;
                    response.body = JSON.stringify(deviceDirectiveRes);
                }
                response.statusCode = presenceRes.code;
                response.body =
                    response.statusCode === 200 ? presenceRes.res : presenceRes.reason;

                break;
            }
            break;
        }
        case "ws_measurements_msg": {
            if (ws_msg) {
                const measurementRes = await devices
                    .insertMonitorLog(ws_msg.message, client_imei)
                    .catch((err) => {
                        response.statusCode = 500;
                        console.error(err);
                    });
                if (measurementRes.error) {
                    response.statusCode = 500;
                    response.body = JSON.stringify(deviceDirectiveRes);
                }
                response.statusCode = measurementRes.code;
                response.body =
                    response.statusCode === 200
                        ? measurementRes.res
                        : measurementRes.reason;
                break;
            }
            break;
        }
        case "ws_directive_msg": {
            if (ws_msg) {
                const deviceDirectiveRes = await devices
                    .deviceDirective(client_imei, ws_msg)
                    .catch((err) => {
                        console.error(err);
                        return { error: err };
                    });
                if (deviceDirectiveRes.error) {
                    response.statusCode = 500;
                    response.body = JSON.stringify(deviceDirectiveRes);
                }
                response.statusCode = deviceDirectiveRes.code;
                response.body =
                    response.statusCode === 200
                        ? deviceDirectiveRes.res
                        : deviceDirectiveRes.reason;
                break;
            }
            break;
        }
        default: {
            break;
        }
    }
    return response;
}
export default deviceRoutes;
