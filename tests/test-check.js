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
        
        let res;
        let retries = 5;

        // Try to register with a small retry loop to handle 502s during boot
        while (retries > 0) {
            res = http.post("http://localhost:8883/api/v1/device", payload, params);
            if (res.status === 200) break;
            
            console.log(`[RETRY] Device ${i+1} got ${res.status}. Retries left: ${retries}`);
            sleep(2);
            retries--;
        }
        
        if (!res || res.status !== 200) {
            console.log(`[FATAL] Registration failed after retries. Status: ${res ? res.status : 'No Res'}. Body: ${res ? res.body : ''}`);
            fail("Setup failed - Backend unreachable via Nginx");
        }

        let d;
        try {
            d = JSON.parse(res.body);
        } catch (e) {
            fail(`JSON Parse Error: ${res.body}`);
        }

        if (d && d.result === "success" && d.key) {
            registrationCount.add(1);
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        } else {
            fail(`Unexpected Structure: ${res.body}`);
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
    console.log("Teardown phase: Test finished.");
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}