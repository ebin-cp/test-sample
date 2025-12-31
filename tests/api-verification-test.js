import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Gauge } from "k6/metrics";

// 1. METRICS DEFINITIONS (Fixed missing definitions)
const total_sent_msgs = new Counter("total_sent_msgs");
const gauge_devices_found = new Gauge('devices_found_count');
const gauge_ws_connections = new Gauge('ws_connections_established');
const gauge_db_records_total = new Gauge('db_records_total');
const gauge_devices_with_data = new Gauge('devices_with_data_count');
const gauge_endpoints_ok = new Gauge('endpoints_success_count'); // Added this missing line

const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m"
};

// 2. SETUP: Create 50 Devices
export function setup() {
    const startTime = Date.now() * 1000000; 
    const deviceKeys = [];
    
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post("http://localhost:8883/api/v1/device", 
            JSON.stringify({ imei }), 
            { headers: { "Content-Type": "application/json" } }
        );
        if (res.status === 200) {
            const d = res.json();
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        }
    }
    return { keys: deviceKeys, startNS: startTime }; 
}

// 3. VU EXECUTION: WebSocket Load
export default function(data) {
    // If setup failed to create keys, stop
    if (!data.keys || data.keys.length === 0) return;

    const myKey = data.keys[(__VU - 1) % data.keys.length];
    const url = "ws://localhost:8883/api/live";

    const res = ws.connect(url, {
        headers: {
            Origin: "robad.in",
            Authorization: `${myKey.imei} ${myKey.api_key}`,
        },
    }, (socket) => {
        socket.on("open", () => {
            gauge_ws_connections.add(1);

            socket.setInterval(() => {
                const ts = Date.now() * 1000000;
                // Sending 4 measurements in one payload
                const payload = [
                    `cellular,imei=${myKey.imei} rssi=16 ${ts}`,
                    `volume,imei=${myKey.imei} vol=100 ${ts}`,
                    `firmware,imei=${myKey.imei} ver=1.0 ${ts}`,
                    `battery,imei=${myKey.imei} v=12 ${ts}`
                ].join("\n");
                
                socket.send(payload);
                total_sent_msgs.add(4); 
            }, ws_msg_interval);
        });

        socket.on("error", (e) => console.error(`WS Error: ${e.error()}`));
    });

    check(res, { "WS Connected": (r) => r && r.status === 101 });
}

// 4. TEARDOWN: Deep Reconciliation
export function teardown(data) {
    if (!data || !data.keys || data.keys.length === 0) return;

    console.log("Waiting 5s for DB synchronization...");
    sleep(5);

    const allDevices = data.keys;
    // Buffer time for clock drift
    const testEndTimeNS = (Date.now() * 1000000) + (5000 * 1000000); 
    const adjustedStartNS = data.startNS - (5000 * 1000000);

    let deviceListCount = 0;
    let successfulEndpoints = 0;
    let devicesWithDataCount = 0;
    let totalDbRecordsFound = 0;

    // A. Check Global Device List
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${allDevices[0].api_key}` }
    });
    if (listRes.status === 200) deviceListCount = listRes.json().length;

    // B. Individual Reconciliation Loop
    allDevices.forEach((device) => {
        const params = { headers: { "Authorization": `${device.api_key}` } };
        const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
        
        const res = http.get(measUrl, params);

        if (res.status === 200) {
            successfulEndpoints++;
            const logs = res.json();
            if (Array.isArray(logs) && logs.length > 0) {
                devicesWithDataCount++;
                totalDbRecordsFound += logs.length;
            }
        }
    });

    // C. Export Results to Gauges
    gauge_devices_found.add(deviceListCount);
    gauge_db_records_total.add(totalDbRecordsFound);
    gauge_devices_with_data.add(devicesWithDataCount);
    gauge_endpoints_ok.add(successfulEndpoints);
    gauge_ws_connections.add(0); // Ensure it's in the summary even if 0

    console.log(`--- RECONCILIATION SUMMARY ---`);
    console.log(`Devices: ${deviceListCount}/50`);
    console.log(`Data: Sent=${total_sent_msgs.value}, Saved=${totalDbRecordsFound}`);
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
    };
}