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
        
        // Log attempt
        console.log(`[SETUP] Registering device ${i+1}/10`);
        
        const res = http.post("http://localhost:8883/api/v1/device", payload, params);
        
        // --- VITAL ERROR HANDLING ---
        if (!res || res.status !== 200) {
            console.error(`[FATAL] Server returned ${res ? res.status : 'No response'}. Body: ${res ? res.body : 'Empty'}`);
            // Force exit with a clear message to avoid the TypeError
            throw new Error(`Setup failed at device ${i+1}. Check if app is connected to DB.`);
        }

        let d;
        try {
            d = res.json();
        } catch (e) {
            console.error(`[FATAL] Failed to parse JSON. Body: ${res.body}`);
            throw new Error("Invalid JSON response from server.");
        }

        // Final structure check
        if (d && d.result === "success" && d.key && d.key.key) {
            registrationCount.add(1);
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        } else {
            console.error(`[FATAL] Missing keys in JSON: ${JSON.stringify(d)}`);
            throw new Error("Server response missing 'key' or 'result'.");
        }
    }

    return { keys: deviceKeys, startNS: startTimeNS };
}

export default function(data) {
    // Check if data was passed correctly from setup
    if (!data || !data.keys || !data.keys[__VU - 1]) {
        return;
    }

    const myKey = data.keys[__VU - 1];
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
    console.log("Load test complete. Entering teardown.");
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}