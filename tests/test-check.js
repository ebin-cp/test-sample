import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { ulid } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const registrationCount = new Counter('registrations');
const ws_metrics_sent_msgs = new Counter('ws_msgs_sent');

const envInterval = __ENV.WS_MSG_INTERVAL;
const ws_msg_interval = envInterval ? Number(envInterval) : 1000;

export const options = {
    vus: 10,
    duration: "1m",
};

export function setup() {
    const deviceKeys = [];
    const numDevices = options.vus;
    const startTimeNS = Date.now() * 1000000;

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
            fail(`Aborting: Received ${res.status} from Registration API. Body: ${res.body}`);
        }
        
        let d;
        try {
            d = res.json();
            // DEBUG: This will show in your GitHub logs if it fails
            console.log(`Registration Response: ${JSON.stringify(d)}`);
        } catch (e) {
            fail(`Aborting: Response not valid JSON. Body: ${res.body}`);
        }

        // FIXED: Added check for !!d to ensure it's not undefined/null
        if (d && typeof d === 'object' && d.result === "success" && d.key) {
            registrationCount.add(1);
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        } else {
            fail(`Aborting: API returned 200 but unexpected structure: ${JSON.stringify(d)}`);
        }
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
    sleep(5); 
    let totalDbRowsFound = 0;

    if (!data || !data.keys || data.keys.length === 0) return;

    // Device Retrieval Check
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${data.keys[0].api_key}` },
        timeout: '120s'
    });

    if (listRes.status === 200 && listRes.body) {
        try {
            const listData = listRes.json();
            console.log('Retrieved Device List Count:', Array.isArray(listData) ? listData.length : "N/A");
        } catch(e) {
            console.log("Teardown: Could not parse list response");
        }
    }

    // Device Measurement endpoint check
    data.keys.forEach((device) => {
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.startNS}&end_ns=${Date.now() * 1000000}`;
        
        const res = http.get(url, {
            headers: { Authorization: `${device.api_key}` },
            timeout: '120s'
        });

        if (res.status === 200) {
            try {
                const rows = res.json();
                const rowCount = Array.isArray(rows) ? rows.length : 0;
                console.log(`DEVICE AUDIT [${device.imei}]: Total Rows Found = ${rowCount}`);
                totalDbRowsFound += rowCount;
            } catch(e) {
                console.log(`DEVICE AUDIT [${device.imei}]: JSON parse error`);
            }
        } else {
            console.log(`DEVICE AUDIT [${device.imei}]: FAILED - Status ${res.status}`);
        }
        sleep(0.2); 
    });

    console.log(`TOTAL AUDIT COMPLETE: Found ${totalDbRowsFound} total entries.`);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}