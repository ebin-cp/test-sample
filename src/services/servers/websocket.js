import { WebSocketServer } from "ws";
import {
    DEVICE_DIRECTIVES,
    INFLUX_LINE_PROTOCOL_SCHEMA,
} from "../../types/message.js";
import deviceRoutes from "../../routes/devices.js";
const wss = new WebSocketServer({ noServer: true });
const clientDetails = new Map();
wss.on("connection", async function connection(ws, request) {
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
    const connectedPresenceRes = await deviceRoutes(
        request,
        device_connected_msg,
    );
    console.log(connectedPresenceRes.statusCode, connectedPresenceRes.body);
    ws.on("message", async function message(data) {
        const details = clientDetails.get(ws);
        if (details) {
            console.log(
                `Received message from IMEI (${details.imei}): \n${data.toString()}`,
            );
        } else {
            console.warn("Details not found for this client.");
        }
        const validate = INFLUX_LINE_PROTOCOL_SCHEMA.safeParse(data.toString());
        const directive_validate = DEVICE_DIRECTIVES.safeParse(data.toString());
        if (validate.error) {
            let errorMessage = "";
            for (const z of validate.error.issues) {
                errorMessage += `${z.message}\n`;
            }
            details?.client.send(errorMessage);
            return;
        }
        if (directive_validate.error) {
            const device_measurements_input = {
                event: "ws_measurements_msg",
                message: validate.data,
            };
            const measurementRes = await deviceRoutes(
                request,
                device_measurements_input,
            );
            if (measurementRes.statusCode === 400) {
                details.client.send(measurementRes.body);
            }
            console.log(measurementRes.statusCode, measurementRes.body);
            return;
        }

        const device_directives_input = {
            event: "ws_directive_msg",
            message: directive_validate.data,
        };
        const directiveMsgRes = await deviceRoutes(
            request,
            device_directives_input,
        );
        details.client.send(directiveMsgRes.body);
        return;
    });
    ws.on("close", async () => {
        clientDetails.delete(ws);
        const device_disconnected_msg = {
            event: "ws_presence_msg",
            message: `${client_imei} disconnected`,
        };
        const presenceRes = await deviceRoutes(request, device_disconnected_msg);
        console.log(presenceRes.statusCode, presenceRes.body);
        console.log("Client Disconnected");
    });
});
wss.on("ping", (_ws, req) => {
    console.log(req.headers);
});
export { wss, clientDetails };
