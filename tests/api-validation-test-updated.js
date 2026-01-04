import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 1000;

export const options = {
    vus: 50,
    duration: "1m", 
};

export function setup() {
    const deviceKeys = [];
    const startTimeNS = Date.now() * 1000000;
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post("http://localhost:8883/api/v1/device", 
            JSON.stringify({ imei }), { headers: { "Content-Type": "application/json" } }
        );
        if (res.status === 200) {
            const d = res.json();
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        }
    }
    if (deviceKeys.length === 0) fail("Setup failed.");
    return { keys: deviceKeys, startTimeNS: startTimeNS };
}

export default function(data) {
    const deviceIndex = (__VU - 1) % data.keys.length;
    const myKey = data.keys[deviceIndex];
    const runStartTimeNS = Date.now() * 1000000;

    ws.connect("ws://localhost:8883/api/live", {
        headers: { Authorization: `${myKey.imei} ${myKey.api_key}` },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                if (Date.now() - (runStartTimeNS / 1000000) > 30000) {
                    socket.close();
                    return;
                }
                const ts = Date.now() * 1000000;
                // 4 metrics per message
                const payload = `vol,imei=${myKey.imei} v=100 ${ts}\ncell,imei=${myKey.imei} r=-70 ${ts}\nfw,imei=${myKey.imei} v=1 ${ts}\nbat,imei=${myKey.imei} l=90 ${ts}`;
                socket.send(payload);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
    });

    sleep(40); // Wait for run + ingestion

    const metrics = ["volume", "cellular", "firmware", "battery"];
    let deviceTotal = 0;
    metrics.forEach(m => {
        const res = http.get(`http://localhost:8883/api/v1/device/measurements?imei=${myKey.imei}&measurement=${m}`, 
            { headers: { "Authorization": `${myKey.api_key}` } });
        if (res.status === 200 && Array.isArray(res.json())) deviceTotal += res.json().length;
    });

    // Name format critical for YAML parsing
    check(deviceTotal, {
        [`Total Messages Count for Device ${deviceIndex}: ${deviceTotal}`]: (v) => v > 0,
    });
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data, null, 4) };
}