import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const registrationCount = new Counter("registrations_total");
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m",
    thresholds: {
        registrations_total: ["count >= 50"],
        // Adjust this based on your expected throughput to avoid false CI failures
        ws_metrics_sent_msgs: ["count >= 100"], 
    },
};

// 1. SETUP: Runs once. Creates 50 devices.
export function setup() {
    const deviceKeys = [];
    console.log("Starting Setup: Registering 50 devices...");

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };

        const res = http.post("http://localhost:8883/api/v1/device", payload, params);

        if (res.status !== 200) {
            fail(`Setup failed at device ${i}: ${res.status} - ${res.body}`);
        }

        const d = res.json();
        registrationCount.add(1);
        deviceKeys.push({ api_key: d.key.key, imei: imei });
    }
    return { keys: deviceKeys };
}

// 2. VU EXECUTION: 50 VUs streaming logs
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
                const logs = [
                    `cellular,imei=${myKey.imei} rssi=16.56,iccid="8991" ${time_str}`,
                    `volume,imei=${myKey.imei} sensorValue=6,volume=100.0 ${time_str}`,
                    `firmware,imei=${myKey.imei} firmware_ver_tx="v1.0.0" ${time_str}`,
                    `battery,imei=${myKey.imei} eBatVolt=12.00 ${time_str}`
                ];
                socket.send(logs.join("\n"));
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });

        socket.on("error", (e) => console.error("WS Error:", e.error()));
    });

    check(res, { "connected successfully": (r) => r && r.status === 101 });
}

// 3. TEARDOWN: Verify API retrieval after test ends
export function teardown(data) {
    const { keys } = data;
    const testDevice = keys[0]; 
    const params = {
        headers: {
            "Authorization": `${testDevice.api_key}`,
            "Content-Type": "application/json"
        }
    };

    console.log(`Teardown: Verifying API for IMEI ${testDevice.imei}`);

    // Verify Device List
    const listRes = http.get("http://localhost:8883/api/v1/devices", params);
    check(listRes, {
        "GET /devices status is 200": (r) => r.status === 200,
        "GET /devices returns data": (r) => r.json().length > 0,
    });

    // Verify Device Logs
    const logUrl = `http://localhost:8883/api/v1/logs?imei=${testDevice.imei}`;
    const logRes = http.get(logUrl, params);
    check(logRes, {
        "GET /logs status is 200": (r) => r.status === 200,
        "GET /logs returns array": (r) => Array.isArray(r.json()),
        "GET /logs has entries": (r) => r.json().length > 0,
    });
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
        "stdout": JSON.stringify(data, null, 2),
    };
}