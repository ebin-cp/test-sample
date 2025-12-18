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
    async function connection(ws: WebSocket, request: IncomingMessage) {
        ws.on("error", console.error);
        if (!request.headers.authorization) {
            ws.close(401);
            return;
        }
        const [client_imei, client_api] = request.headers.authorization.split(" ");

        console.log(`Device ${client_imei} connected using API KEY ${client_api}`);

        clientDetails.set(ws, {
            api_key: `${client_api}`,
            imei: `${client_imei}`,
            client: ws,
        });
        const device_connected_msg = {
            event: "ws_presence_msg",
            message: `${client_imei} connected`,
        };
        await deviceRoutes(request, device_connected_msg);
        ws.on("message", async function message(data: Buffer) {
            const details = clientDetails.get(ws);

            if (details) {
                console.log(
                    `Received message from IMEI (${details.imei}): \n${data.toString()}`,
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
            const device_measurements_input = {
                event: "ws_measurements_msg",
                message: validate.data,
            };
            await deviceRoutes(request, device_measurements_input);
        });

        ws.on("close", async () => {
            clientDetails.delete(ws);
            const device_disconnected_msg = {
                event: "ws_presence_msg",
                message: `${client_imei} disconnected`,
            };
            await deviceRoutes(request, device_disconnected_msg);
            console.log("Client Disconnected");
        });
    },
);

wss.on("ping", (_ws: WebSocketServer, req: IncomingMessage) => {
    console.log(req.headers);
});

export { wss, clientDetails };
