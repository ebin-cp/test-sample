import { WebSocketServer } from "ws";
import {
    DEVICE_DIRECTIVES,
    INFLUX_LINE_PROTOCOL_SCHEMA,
} from "../../types/message.js";
import deviceRoutes from "../../routes/devices.js";
import logfmt from "../../utils/logfmt.js";

const wss = new WebSocketServer({ noServer: true });
const clientDetails = new Map();
wss.on("connection", async function connection(ws, request) {
    ws.on("error", () => {
        logfmt("error", {
            event: "Websocket",
            msg: "Websocket error event triggered",
        });
    });
    if (!request.headers.authorization) {
        ws.close(401);
        return;
    }
    const [client_imei, client_api] = request.headers.authorization.split(" ");
    logfmt("info", {
        event: "Device Connect",
        imei: client_imei,
    });
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
    logfmt(connectedPresenceRes.statusCode !== 200 ? "error" : "info", {
        event: "Device Presence",
        ...connectedPresenceRes,
    });
    ws.on("message", async function message(data) {
        const details = clientDetails.get(ws);
        if (!details) {
            logfmt("warn", {
                event: "Incoming Message",
                msg: "Device details not found",
                imei: details.imei,
            });
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
        for (const msg_data of validate.data.split("\n")) {
            logfmt("info", {
                event: "Incoming Message",
                msg: msg_data,
            });
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
            logfmt(measurementRes.statusCode !== 200 ? "error" : "info", {
                event: "Device Measurements",
                ...measurementRes,
            });
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
        logfmt(presenceRes.statusCode !== 200 ? "error" : "info", {
            event: "Device Presence",
            ...presenceRes,
        });
        logfmt("info", {
            event: "Device Disconnect",
            imei: client_imei,
        });
    });
});
wss.on("ping", (_ws, req) => {
    logfmt("info", {
        event: "Websocket Ping",
        ...req.headers,
    });
});
export { wss, clientDetails };
