import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { INFLUX_LINE_PROTOCOL_SCHEMA } from "../../types/message.mjs";
import deviceRoutes from "../../routes/devices.mjs";

const wss = new WebSocketServer({ noServer: true });
const clientDetails = new Map<
    WebSocket,
    { api_key: string; imei: string; client: WebSocket }
>();

wss.on(
    "connection",
    function connection(ws: WebSocket, request: IncomingMessage) {
        ws.on("error", console.error);
        if (!request.headers.authorization) {
            ws.close(401);
            return;
        }
        const [client_api, client_imei] = request.headers.authorization.split(" ");

        console.log(`Device ${client_imei} connected using API KEY ${client_api}`);

        clientDetails.set(ws, {
            api_key: `${client_api}`,
            imei: `${client_imei}`,
            client: ws,
        });
        ws.on("message", async function message(data: Buffer) {
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
            await deviceRoutes(request, validate.data);
        });

        ws.on("close", () => {
            clientDetails.delete(ws);
            console.log("Client Disconnected");
        });
    },
);

wss.on("ping", (_ws: WebSocketServer, req: IncomingMessage) => {
    console.log(req.headers);
});

export { wss, clientDetails };
