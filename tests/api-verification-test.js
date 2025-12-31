import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Gauge } from "k6/metrics";

// 1. METRICS DEFINITIONS
const total_sent_msgs = new Counter("total_sent_msgs");
const gauge_devices_found = new Gauge('devices_found_count');
const gauge_ws_connections = new Gauge('ws_connections_established');
const gauge_db_records_total = new Gauge('db_records_total');
const gauge_devices_with_data = new Gauge('devices_with_data_count');

const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m"
};

// 2. SETUP: Create 50 Devices
export function setup() {
    const startTime = Date.now() * 1000000; // Nanoseconds
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
    // Pass data to VUs and Teardown
    return { keys: deviceKeys, startNS: startTime }; 
}

// 3. VU EXECUTION: WebSocket Load
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
            // Track successful connection
            gauge_ws_connections.add(1);

            socket.setInterval(() => {
                const ts = Date.now() * 1000000;
                const payload = [
                    `cellular,imei=${myKey.imei} rssi=16 ${ts}`,
                    `volume,imei=${myKey.imei} vol=100 ${ts}`,
                    `firmware,imei=${myKey.imei} ver=1.0 ${ts}`,
                    `battery,imei=${myKey.imei} v=12 ${ts}`
                ].join("\n");
                
                socket.send(payload);
                // We send 4 measurements per interval
                total_sent_msgs.add(4); 
            }, ws_msg_interval);
        });

        socket.on("error", (e) => console.error(`WS Error: ${e.error()}`));
    });

    check(res, { "WS Connected": (r) => r && r.status === 101 });
}

// 4. TEARDOWN: Data Reconciliation & Integrity Check
export function teardown(data) {
    if (!data || !data.keys || data.keys.length === 0) return;

    // Wait for the last DB writes to settle (crucial for 100ms tests)
    console.log("Waiting 5s for DB synchronization...");
    sleep(5);

    const allDevices = data.keys;
    const testEndTimeNS = (Date.now() * 1000000) + (5000 * 1000000); 
    const adjustedStartNS = data.startNS - (5000 * 1000000);

    let deviceListCount = 0;
    let successfulEndpoints = 0;
    let devicesWithDataCount = 0;
    let totalDbRecordsFound = 0;

    // Check Device List
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${allDevices[0].api_key}` }
    });
    if (listRes.status === 200) deviceListCount = listRes.json().length;

    // Individual Device Data Check
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

    // Update Gauges for GitHub YAML
    gauge_devices_found.add(deviceListCount);
    gauge_db_records_total.add(totalDbRecordsFound);
    gauge_devices_with_data.add(devicesWithDataCount);
    gauge_endpoints_ok.add(successfulEndpoints);

    // Summary Logging
    console.log(`--- FINAL RECONCILIATION REPORT ---`);
    console.log(`Devices: Created=50, Found=${deviceListCount}`);
    console.log(`Connections: Established=${gauge_ws_connections.value}`);
    console.log(`Data: Sent=${total_sent_msgs.value}, Received=${totalDbRecordsFound}`);
    console.log(`Integrity: Devices with Data=${devicesWithDataCount}/50`);

    // Checks to trigger Exit Code 1 on failure
    check(deviceListCount, { "API: 50 Devices Exist": (v) => v === 50 });
    check(devicesWithDataCount, { "API: All Devices Have Data": (v) => v === 50 });
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
    };
}