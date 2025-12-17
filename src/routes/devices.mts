import type { IncomingMessage } from "node:http";
import connection from "../services/db-connection/db-connection.mjs";
import { DeviceService } from "../services/device/device.mjs";
import getRequestBody from "../utils/get-request-body.mjs";

async function deviceRoutes(req: IncomingMessage, ws_msg?: string) {
    const url_parsed = new URL(
        `http://${process.env.HOST ?? "localhost"}${req.url}`,
    );
    const routeKey: string = ws_msg ? "ws_msg" : `${req.method} ${url_parsed.pathname}`;
    const devices = new DeviceService(connection);
    const response: { statusCode: number; body: object | string } = {
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

            const readReq = await devices.get_monitorlog(
                imei,
                measurement,
                timeperiod,
            );
            response.body = JSON.stringify(readReq);
            response.statusCode = 200;
            break;
        }
        case "ws_msg": {
            console.log("Inserting");
            if (ws_msg) {
                await devices.insert_monitorlog(ws_msg);
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
