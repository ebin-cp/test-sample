import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

const registrationCount = new Counter("registrations_total");
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
// Fallback to 300 if environment variable is missing
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m",
    thresholds: {
        "registrations_total": ["count >= 50"],
        "ws_metrics_sent_msgs": ["count >= 1000"], // Adjusted to be safer
    },
};

export function setup() {
    const deviceKeys = [];
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };

        const res = http.post("http://localhost:8883/api/v1/device", payload, params);
        
        if (res.status !== 200) {
            fail(`Setup failed: ${res.status} - ${res.body}`);
        }

        const d = res.json();
        registrationCount.add(1);
        // Ensure we store exactly what the WebSocket/API needs
        deviceKeys.push({ api_key: d.key.key, imei: imei });
    }
    return { keys: deviceKeys };
}

export default function(data) {
    // Safely select a key for the current VU
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
                    `cellular,imei=${myKey.imei} rssi=16.56,iccid="8991",operator="airtel" ${time_str}`,
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

    check(res, { "websocket connected": (r) => r && r.status === 101 });
}

export function teardown(data) {
    const { keys } = data;
    const testDevice = keys[0]; 
    const params = {
        headers: {
            "Authorization": `${testDevice.api_key}`,
            "Content-Type": "application/json"
        }
    };

    // Verify List API
    const listRes = http.get("http://localhost:8883/api/v1/devices", params);
    check(listRes, {
        "API: Device list 200": (r) => r.status === 200,
        "API: Device list has data": (r) => r.json().length > 0,
    });

    // Verify Logs API
    const logUrl = `http://localhost:8883/api/v1/logs?imei=${testDevice.imei}`;
    const logRes = http.get(logUrl, params);
    
    check(logRes, {
        "API: Logs 200": (r) => r.status === 200,
        "API: Logs are array": (r) => Array.isArray(r.json()),
    });
}

// Single definition of handleSummary
export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
        "stdout": JSON.stringify(data, null, 2), // Also print to console for debugging
    };
}