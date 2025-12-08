import { IncomingMessage } from "node:http";
import connection from "../services/db-connection/db-connection.mjs";
import { DeviceService } from "../services/device/device.mjs";
import getRequestBody from "../utils/get-request-body.mjs";

async function deviceRoutes(req: IncomingMessage) {
    const routeKey: string = `${req.method} ${req.url}`;
    const devices = new DeviceService(connection);
    let response: { statusCode: number; body: object | string } = {
        statusCode: 403,
        body: JSON.stringify({ error: "Invalid" }),
    };
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
        default: {
            break;
        }
    }
    return response;
}

export default deviceRoutes;
