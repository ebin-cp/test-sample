import { IncomingMessage } from "node:http";
import connection from "../services/db-connection/db-connection.mjs";
import { DeviceService } from "../services/device/device.mjs";
import getRequestBody from "../utils/get-request-body.mjs";

async function deviceRoutes(req: IncomingMessage, ws_msg?: string) {
    const routeKey: string = ws_msg?'ws_msg':`${req.method} ${req.url}`;
    const devices = new DeviceService(connection);
    let response: { statusCode: number; body: object | string } = {
        statusCode: 403,
        body: JSON.stringify({ error: "Invalid" }),
    };
    console.log(ws_msg)
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
        case 'ws_msg': {
            console.log("Inserting")
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
