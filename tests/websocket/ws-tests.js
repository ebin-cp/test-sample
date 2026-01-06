import ws from "k6/ws";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");

export function sendWsMetrics(imei, apiKey) {
    const interval = Number(__ENV.WS_MSG_INTERVAL) || 1000;
    ws.connect("ws://localhost:8883/api/live", {
        headers: { Origin: "robad.in", Authorization: `${imei} ${apiKey}` },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const ts = Date.now() * 1000000;
                socket.send(`cellular,imei=${imei} rssi=16 ${ts}\nvolume,imei=${imei} vol=100 ${ts}\nbattery,imei=${imei} v=12 ${ts}`);
                ws_metrics_sent_msgs.add(1);
            }, interval);
        });
    });
}