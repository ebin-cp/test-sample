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
                // Sending 4 lines (metrics) per message
                const payload = `volume,imei=${myKey.imei} vol=100 ${ts}\ncellular,imei=${myKey.imei} rssi=-70 ${ts}\nfirmware,imei=${myKey.imei} ver=1 ${ts}\nbattery,imei=${myKey.imei} lvl=90 ${ts}`;
                socket.send(payload);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
    });

    // Wait for the 30s test duration + 10s for DB ingestion
    sleep(40); 

    const metricsToCheck = ["volume", "cellular", "firmware", "battery"];
    let totalMessagesForThisDevice = 0;

    metricsToCheck.forEach((metric) => {
        const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${myKey.imei}&measurement=${metric}`;
        const measRes = http.get(measUrl, { headers: { "Authorization": `${myKey.api_key}` } });
        
        if (measRes.status === 200) {
            const body = measRes.json();
            if (Array.isArray(body)) totalMessagesForThisDevice += body.length;
        }
    });

    // The name ending in ${totalMessagesForThisDevice} is required for the YAML grep
    check(totalMessagesForThisDevice, {
        [`Total Messages Count for Device ${deviceIndex}: ${totalMessagesForThisDevice}`]: (v) => v > 0,
    });
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data, null, 4) };
}