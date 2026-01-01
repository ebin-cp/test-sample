import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m",
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
    const deviceKeys = [];
    
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post("http://localhost:8883/api/v1/device", 
            JSON.stringify({ imei }), 
            { headers: { "Content-Type": "application/json" } }
        );
        
        if (res.status === 200) {
            const d = res.json();
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        } else {
            console.log(`Failed to create device ${i}: Status ${res.status}`);
        }
    }

    if (deviceKeys.length === 0) {
        fail("No devices were created. Stopping test.");
    }

    return { keys: deviceKeys, startTimeNS: startTimeNS };
}

export default function(data) {
    const myKey = data.keys[(__VU - 1) % data.keys.length];
    const url = "ws://localhost:8883/api/live";

    const res = ws.connect(url, {
        headers: {
            Origin: "robad.in",
            Authorization: `${myKey.imei} ${myKey.api_key}`,
        },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const ts = Date.now() * 1000000;
                const payload = [
                    `cellular,imei=${myKey.imei} rssi=16 ${ts}`,
                    `volume,imei=${myKey.imei} vol=100 ${ts}`,
                    `firmware,imei=${myKey.imei} ver=1.0 ${ts}`,
                    `battery,imei=${myKey.imei} v=12 ${ts}`
                ].join("\n");

                socket.send(payload);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
    });
    check(res, { "WS Connected": (r) => r && r.status === 101 });
}

export function teardown(data) {
    const bufferNS = 5000 * 1000000; 
    const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
    const adjustedStartNS = data.startTimeNS - bufferNS;

    const metricsToCheck = ["volume", "cellular", "firmware", "battery"];

    console.log(`[Teardown] Starting validation for ${data.keys.length} devices...`);

    data.keys.forEach((testDevice, index) => {
        const params = { 
            headers: { 
                "Authorization": `${testDevice.api_key}`,
                "Content-Type": "application/json"
            } 
        };

        metricsToCheck.forEach((metric) => {
            const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${testDevice.imei}&measurement=${metric}&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
            const measRes = http.get(measUrl, params);

            const success = measRes.status === 200;
            const hasData = success && measRes.json() && measRes.json().length > 0;

            check(measRes, {
                [`${metric} Data Exists (Device ${index})`]: (r) => hasData,
            });

            if (!hasData) {
                console.log(`[Alert] Missing ${metric} for IMEI: ${testDevice.imei} (Status: ${measRes.status})`);
            }
        });
    });
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
        // "stdout": JSON.stringify(data, null, 2),
    }
}