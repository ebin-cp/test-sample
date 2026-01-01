import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { ulid } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const registrationCount = new Counter('registrations');
const ws_metrics_sent_msgs = new Counter('ws_msgs_sent');
const ws_msg_interval = __ENV.WS_MSG_INTERVAL ? Number(__ENV.WS_MSG_INTERVAL) : 1000;

export const options = {
    vus: 10,
    duration: "1m",
};

export function setup() {
    const deviceKeys = [];
    const numDevices = 10;
    const startTimeNS = Date.now() * 1000000;

    for (let i = 0; i < numDevices; i++) {
        const imei = ulid();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };
        
        console.log(`[SETUP] Registering device ${i + 1}/${numDevices} with IMEI: ${imei}`);
        
        const res = http.post("http://localhost:8883/api/v1/device", payload, params);
        
        // 1. Check if response exists at all
        if (!res) {
            fail("[FATAL] No response received from server. Is the Nginx proxy running?");
        }

        // 2. Check status code
        if (res.status !== 200) {
            console.error(`[ERROR] Registration failed. Status: ${res.status}. Body: ${res.body}`);
            fail(`[FATAL] Server returned ${res.status} instead of 200.`);
        }

        // 3. Safe JSON parsing
        let d;
        try {
            // Only try to parse if there's actually a body string
            if (res.body && res.body.trim().length > 0) {
                d = JSON.parse(res.body);
            } else {
                fail("[FATAL] Server returned 200 but the response body was empty.");
            }
        } catch (e) {
            console.error(`[ERROR] Failed to parse JSON. Raw Body: ${res.body}`);
            fail("[FATAL] Response body was not valid JSON.");
        }

        // 4. Validate object structure
        if (d && d.result === "success" && d.key && d.key.key) {
            registrationCount.add(1);
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        } else {
            console.error(`[ERROR] Unexpected JSON format: ${JSON.stringify(d)}`);
            fail("[FATAL] JSON structure is missing 'result' or 'key'.");
        }
    }

    return { keys: deviceKeys, startNS: startTimeNS };
}

export default function(data) {
    if (!data || !data.keys || !data.keys[__VU - 1]) return;
    const myKey = data.keys[__VU - 1];
    
    const res = ws.connect("ws://localhost:8883/api/live", {
        headers: {
            Origin: "robad.in",
            Authorization: `${myKey.imei} ${myKey.api_key}`,
        },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const time_str = Date.now() * 1000000;
                const msg = `volume,imei=${myKey.imei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                socket.send(msg);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
        socket.on("error", (e) => console.error("WS Error:", e.error()));
    });

    check(res, { "connected successfully": (r) => r && r.status === 101 });
}

export function teardown(data) {
    if (!data || !data.keys) return;
    console.log("Teardown started...");
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}