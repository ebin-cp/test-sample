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
        
        const res = http.post("http://localhost:8883/api/v1/device", payload, params);
        
        // --- CRITICAL FIX START ---
        if (!res || res.status !== 200) {
            // This will print to your GitHub Action console so you can see the REAL error
            console.log(`FAILED TO REGISTER. Status: ${res ? res.status : 'No Response'}. Body: ${res ? res.body : 'Empty'}`);
            fail(`Stopping test: Setup failed on device ${i+1}`);
        }

        let d;
        try {
            d = res.json();
        } catch (e) {
            fail(`Aborting: API returned 200 but body was not JSON. Body: ${res.body}`);
        }

        // Only check properties if d actually exists
        if (d && d.result === "success" && d.key) {
            registrationCount.add(1);
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        } else {
            fail(`Aborting: Unexpected JSON structure: ${JSON.stringify(d)}`);
        }
        // --- CRITICAL FIX END ---
    }
    return { keys: deviceKeys, startNS: startTimeNS };
}

export default function(data) {
    if (!data || !data.keys || !data.keys[__VU - 1]) return;

    const myKey = data.keys[__VU - 1];
    const url = "ws://localhost:8883/api/live";
    
    const res = ws.connect(
        url,
        {
            headers: {
                Origin: "robad.in",
                Authorization: `${myKey.imei} ${myKey.api_key}`,
            },
        },
        (socket) => {
            socket.on("open", () => {
                socket.setInterval(() => {
                    const time_str = Date.now() * 1000000;
                    const msg = `volume,imei=${myKey.imei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                    socket.send(msg);
                    ws_metrics_sent_msgs.add(1);
                }, ws_msg_interval);
            });
            socket.on("error", (e) => console.error("WS Error:", e.error()));
        }
    );

    check(res, { "connected successfully": (r) => r && r.status === 101 });
}

export function teardown(data) {
    if (!data || !data.keys || data.keys.length === 0) return;
    
    // Increased sleep to let DB finish writing
    sleep(10); 
    
    let totalDbRowsFound = 0;

    data.keys.forEach((device) => {
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.startNS}&end_ns=${Date.now() * 1000000}`;
        const res = http.get(url, { headers: { Authorization: device.api_key } });

        if (res.status === 200) {
            const rows = res.json();
            if (Array.isArray(rows)) {
                totalDbRowsFound += rows.length;
            }
        }
    });
    console.log(`TOTAL AUDIT COMPLETE: Found ${totalDbRowsFound} total entries.`);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}