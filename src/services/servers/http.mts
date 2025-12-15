import { createServer } from "node:http";
import deviceRoutes from "../../routes/devices.mjs";
import authenticate from "../auth/websocket.mjs";
import onSocketError from "../errors/websocket.mjs";
import { clientDetails, wss } from "./websocket.mjs";

const server = createServer();

server.on("request", async (req, res) => {
    const routeKey: string = `${req.url}`;
    const response: { statusCode: number; body: object | string } = {
        statusCode: 403,
        body: JSON.stringify({ error: "Invalid" }),
    };
    switch (true) {
        case routeKey.includes("/api/v1/device"): {
            const routeReq = await deviceRoutes(req);
            response.body = routeReq.body;
            response.statusCode = routeReq.statusCode;
            break;
        }
        default: {
            break;
        }
    }
    res.setHeader("Content-Type", "application/json");
    res.writeHead(response.statusCode);
    res.end(response.body);
    return;
});

server.on("upgrade", async function upgrade(request, socket, head) {
    if (request.url !== "/api/live") {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
    }
    socket.on("error", onSocketError);

    await authenticate(request, function next(err, client) {
        if (err || !client) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }

        if (clientDetails.size) {
            for (const i of clientDetails) {
                console.log("Listing Keys ", i[1].api_key);
                if (i[1].api_key === request.headers.authorization) {
                    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                    socket.destroy();
                    return;
                }
            }
        }

        socket.removeListener("error", onSocketError);

        wss.handleUpgrade(request, socket, head, function done(ws) {
            wss.emit("connection", ws, request, client);
        });
    });
});

export default server;
