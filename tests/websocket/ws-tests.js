import ws from "k6/ws";
import { check } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 1000;

export function sendWsMetrics(imei, apiKey) {
    const url = "ws://localhost:8883/api/live";

    const res = ws.connect(url, {
        headers: {
            Origin: "robad.in",
            Authorization: `${imei} ${apiKey}`,
        },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const ts = Date.now() * 1000000;
                const payload = [
                    `cellular,imei=${imei} rssi=16 ${ts}`,
                    `volume,imei=${imei} vol=100 ${ts}`,
                    `firmware,imei=${imei} ver=1.0 ${ts}`,
                    `battery,imei=${imei} v=12 ${ts}`
                ].join("\n");
                socket.send(payload);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
    });

    check(res, { "WS Connected": (r) => r && r.status === 101 });
}