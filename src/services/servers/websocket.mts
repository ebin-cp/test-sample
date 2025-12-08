import { createServer, type IncomingMessage } from "node:http";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import authenticate from "../auth/websocket.mjs";
import onSocketError from "../errors/websocket.mjs";
import { INFLUX_LINE_PROTOCOL_SCHEMA } from "../../types/message.mjs";
import deviceRoutes from "../../routes/devices.mjs";

const server = createServer();
const wss = new WebSocketServer({ noServer: true });
const clientDetails = new Map<
    WebSocket,
    { api_key: string; client: WebSocket }
>();

wss.on(
    "connection",
    function connection(ws: WebSocket, request: IncomingMessage) {
        ws.on("error", console.error);
        const client_api = request.headers.authorization;

        console.log(`Device connected using API KEY = ${client_api}`);

        clientDetails.set(ws, { api_key: `${client_api}`, client: ws });
        ws.on("message", function message(data: Buffer) {
            const details = clientDetails.get(ws);

            if (details) {
                console.log(
                    `Received message from IP ${details.api_key}: ${data.toString()}`,
                );
            } else {
                console.warn("Details not found for this client.");
            }
            const validate = INFLUX_LINE_PROTOCOL_SCHEMA.safeParse(data.toString());
            if (validate.error) {
                let errorMessage = "";
                for (const z of validate.error.issues) {
                    errorMessage += `${z.message}\n`;
                }
                details?.client.send(errorMessage);
                return;
            }
            console.log(
                `Received message ${validate.data} from user ${request.headers.origin}`,
            );
        });

        ws.on("close", () => {
            clientDetails.delete(ws);
            console.log("Client Disconnected");
        });
    },
);

wss.on("ping", (ws: WebSocketServer, req: IncomingMessage) => {
    console.log(req.headers);
});

server.on("request", async (req, res) => {
    const routeKey: string = `${req.url}`;
    let response: { statusCode: number; body: object | string } = {
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

        socket.removeListener("error", onSocketError);

        wss.handleUpgrade(request, socket, head, function done(ws) {
            wss.emit("connection", ws, request, client);
        });
    });
});

export default server;
