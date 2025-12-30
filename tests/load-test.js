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
    thresholds: {
        checks: ["rate>0.9"], // 90% of checks must pass
    },
};

export function setup() {
    const deviceKeys = [];
    const params = { 
        headers: { 
            "Content-Type": "application/json",
            "Origin": "robad.in" 
        } 
    };

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post("http://localhost:8883/api/v1/device", JSON.stringify({ imei }), params);

        if (res.status !== 200) {
            console.error(`Device ${i} registration failed: ${res.status} ${res.body}`);
            continue; 
        }

        const d = res.json();
        deviceKeys.push({ api_key: d.key.key, imei: imei });
    }

    if (deviceKeys.length === 0) fail("No devices registered. Aborting.");
    return { keys: deviceKeys };
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
                const time_str = Date.now() * 1000000;
                const cellular_log = `cellular,imei=${myKey.imei} rssi=16.56 ${time_str}`;
                socket.send(cellular_log);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
    });

    check(res, { "WS connected": (r) => r && r.status === 101 });
}

export function teardown(data) {
    const testDevice = data.keys[0];
    const params = { 
        headers: { 
            "Authorization": `${testDevice.api_key}`,
            "Origin": "robad.in"
        } 
    };

    // 1. ADDED: Verify Device List Retrieval
    const listRes = http.get("http://localhost:8883/api/v1/devices", params);
    check(listRes, {
        "API: Get Devices 200": (r) => r.status === 200,
        "API: List contains data": (r) => r.json() && r.json().length > 0,
    });

    // 2. ADDED: Verify Device Logs Retrieval
    const logRes = http.get(`http://localhost:8883/api/v1/logs?imei=${testDevice.imei}`, params);
    check(logRes, {
        "API: Get Logs 200": (r) => r.status === 200,
        "API: Logs count > 0": (r) => r.json() && r.json().length > 0,
    });

    console.log(`Teardown complete. Verified API for device: ${testDevice.imei}`);
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
        "stdout": JSON.stringify(data, null, 2),
    };
}