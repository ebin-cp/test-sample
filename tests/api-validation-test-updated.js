import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");

export const options = {
    vus: 50,
    iterationVUs: 50,
    thresholds: {
        "ws_metrics_sent_msgs": ["count > 0"], // Fails test if no messages sent
    },
};

export function setup() {
    const deviceKeys = [];
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
    if (deviceKeys.length === 0) fail("Setup failed: 0 devices created.");
    return { keys: deviceKeys };
}

export default function(data) {
    const deviceIndex = (__VU - 1) % data.keys.length;
    const myKey = data.keys[deviceIndex];
    const runTimeMS = 30000;
    const start = Date.now();

    const res = ws.connect("ws://localhost:8883/api/live", {
        headers: { Authorization: `${myKey.imei} ${myKey.api_key}` },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                if (Date.now() - start > runTimeMS) {
                    socket.close();
                    return;
                }
                const ts = Date.now() * 1000000;
                // 4 metrics per line protocol message
                const payload = `volume,imei=${myKey.imei} v=100 ${ts}\ncellular,imei=${myKey.imei} r=-70 ${ts}\nfirmware,imei=${myKey.imei} v=1 ${ts}\nbattery,imei=${myKey.imei} l=90 ${ts}`;
                socket.send(payload);
                ws_metrics_sent_msgs.add(1);
            }, 1000);
        });
        socket.on("error", (e) => console.log(`WS Error: ${e.error()}`));
    });

    check(res, { "WS Connected": (r) => r && r.status === 101 });
    
    // Wait for the test duration + ingestion buffer
    sleep(35);

    const metrics = ["volume", "cellular", "firmware", "battery"];
    let deviceTotal = 0;
    metrics.forEach(m => {
        const r = http.get(`http://localhost:8883/api/v1/device/measurements?imei=${myKey.imei}&measurement=${m}`, 
            { headers: { "Authorization": `${myKey.api_key}` } });
        if (r.status === 200) deviceTotal += (r.json() || []).length;
    });

    check(deviceTotal, {
        [`Total Messages Count for Device ${deviceIndex}: ${deviceTotal}`]: (v) => v > 0,
    });
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data, null, 4) };
}