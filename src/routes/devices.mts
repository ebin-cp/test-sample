import { IncomingMessage, ServerResponse } from "node:http";
import connection from "../services/db-connection/db-connection.mjs";
import { DeviceService } from "../services/device/device.mjs";
import { ulid } from "ulid";

async function deviceRoutes(req: IncomingMessage, res: ServerResponse) {
    console.log(req.headers);
    const tables = await connection.query("SHOW TABLES;");

    console.log(tables);

    const devices = new DeviceService(connection);

    devices.create(ulid());

    res.writeHead(200);
    res.end(JSON.stringify(tables));
}

export default deviceRoutes;
