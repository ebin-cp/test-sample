import { DeviceService } from "../services/device/device.js";
import getRequestBody from "../utils/get-request-body.js";
import dbConnection from "../services/db-connection/db-connection.js";
async function deviceRoutes(req, ws_msg) {
    const url_parsed = new URL(`http://${process.env.HOST ?? "localhost"}${req.url}`);
    const routeKey = ws_msg
        ? ws_msg.event
        : `${req.method} ${url_parsed.pathname}`;
    const connection = await dbConnection();
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
            const readReq = await devices.get();
            response.body = JSON.stringify(readReq);
            response.statusCode = 200;
            break;
        }
        case "POST /api/v1/device": {
            const reqBody = await getRequestBody(req);
            const reqBodyJson = JSON.parse(reqBody);
            const createReq = await devices.create(reqBodyJson.imei).then((res) => {
                console.log(res);
                return res;
            });
            response.body = JSON.stringify(createReq);
            response.statusCode = 200;
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
            const readReq = await devices.getMonitorLog(imei, measurement, timeperiod);
            response.body = JSON.stringify(readReq);
            response.statusCode = 200;
            break;
        }
        case "ws_presence_msg": {
            if (ws_msg) {
                const [imei, event] = ws_msg.message.split(" ");
                if (!imei || !event) {
                    response.statusCode = 400;
                    break;
                }
                await devices.devicePresence(imei, event);
            }
            break;
        }
        case "ws_measurements_msg": {
            if (ws_msg) {
                await devices.insertMonitorLog(ws_msg.message);
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
