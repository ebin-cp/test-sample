import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail, sleep } from 'k6'; // Added sleep
import { Counter } from 'k6/metrics';
import { ulid } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const registrationCount = new Counter('registrations');
const ws_metrics_sent_msgs = new Counter('ws_msgs_sent');

// Safe parsing for the environment variable
const envInterval = __ENV.WS_MSG_INTERVAL;
const ws_msg_interval = envInterval ? Number(envInterval) : 1000;

export const options = {
    vus: 10,
    duration: "1m",
};

export function setup() {
    const deviceKeys = [];
    const numDevices = options.vus;
    const startTimeNS = Date.now() * 1000000; // Capture start for teardown query

    for (let i = 0; i < numDevices; i++) {
        const imei = ulid();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };
        const res = http.post(
            "http://localhost:8883/api/v1/device", 
            payload,
            params
        );
        
        if (res.status !== 200) {
            fail(`Aborting: Received ${res.status}. Body: ${res.body}`);
        }
        
        let d;
        try {
            d = res.json();
        } catch (e) {
            fail(`Aborting: Response not valid JSON. Body: ${res.body}`);
        }

        if (d && d.result === "success" && d.key) {
            registrationCount.add(1);
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        } else {
            fail(`Aborting: Unexpected JSON structure: ${JSON.stringify(d)}`);
        }
    }
    // Return keys AND the start time for the teardown audit
    return { keys: deviceKeys, startNS: startTimeNS };
}

export default function(data) {
    if (!data.keys[__VU - 1]) return;

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
                    const volume_log = `volume,imei=${myKey.imei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                    
                    socket.send(volume_log);
                    ws_metrics_sent_msgs.add(1);
                }, ws_msg_interval);
            });

            socket.on("error", (e) => console.error("WS Error:", e.error()));
        }
    );

    check(res, { "connected successfully": (r) => r && r.status === 101 });
}
    
export function teardown(data) {
    // Wait for server to flush buffers
    sleep(5); 

    let totalDbRowsFound = 0; // Declared missing variable

    // Device Retrieval Check
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${data.keys[0].api_key}` },
        timeout: '120s'
    });

    if (listRes.status === 200 && listRes.body.length !== 0) {
        const listData = listRes.json();
        console.log('Retrieved Device List Count:', listData.length);
    }

    // Device Measurement endpoint check
    data.keys.forEach((device) => {
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.startNS}&end_ns=${Date.now() * 1000000}`;
        
        const res = http.get(url, {
            headers: { Authorization: `${device.api_key}` },
            timeout: '120s'
        });

        if (res.status === 200) {
            const rows = res.json();
            const rowCount = Array.isArray(rows) ? rows.length : 0;
            console.log(`DEVICE AUDIT [${device.imei}]: Total Rows Found = ${rowCount}`);
            totalDbRowsFound += rowCount;
        } else {
            console.log(`DEVICE AUDIT [${device.imei}]: FAILED - Status ${res.status}`);
        }
        // Small sleep to avoid hammering the DB during teardown
        sleep(0.5); 
    });

    console.log(`TOTAL AUDIT COMPLETE: Found ${totalDbRowsFound} total entries across all devices.`);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}