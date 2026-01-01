import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const registrationCount = new Counter('registrations');
const ws_metrics_sent_msgs = new Counter('ws_msgs_sent');
const ws_msg_interval = __ENV.WS_MSG_INTERVAL ? Number(__ENV.WS_MSG_INTERVAL) : 1000;

export const options = {
    vus: 10,
    duration: "1m",
};

// Helper to replace external ULID dependency
function generateID() {
    return 'dev-' + Math.random().toString(36).substring(2, 15);
}

export function setup() {
    const deviceKeys = [];
    const numDevices = 10;
    const startTimeNS = Date.now() * 1000000;

    for (let i = 0; i < numDevices; i++) {
        const imei = generateID();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };
        
        console.log(`[SETUP] Requesting device ${i+1}/10`);
        
        const res = http.post("http://localhost:8883/api/v1/device", payload, params);
        
        // Check 1: Did the request fail?
        if (!res || res.status !== 200) {
            console.log(`[FATAL] HTTP Error ${res ? res.status : 'No Res'}: ${res ? res.body : 'No Body'}`);
            fail("Setup failed - Server unreachable or returned error");
        }

        // Check 2: Manually parse to avoid .json() issues
        let d;
        try {
            d = JSON.parse(res.body);
        } catch (e) {
            console.log(`[FATAL] JSON Parse Error. Body was: ${res.body}`);
            fail("Setup failed - Response not JSON");
        }

        // Check 3: Final validation
        if (d && d.result === "success" && d.key && d.key.key) {
            registrationCount.add(1);
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        } else {
            console.log(`[FATAL] Structure mismatch: ${res.body}`);
            fail("Setup failed - Unexpected JSON keys");
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
    console.log("Teardown complete");
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}