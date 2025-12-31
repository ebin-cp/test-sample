import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Gauge } from "k6/metrics";

// Metrics for the GitHub Summary
const gauge_devices_found = new Gauge('devices_found_count');
const gauge_conn_success = new Gauge('connections_success_count');
const gauge_integrity_pass = new Gauge('integrity_passed_count');
const gauge_total_sent = new Gauge('total_sent_count');
const gauge_total_saved = new Gauge('total_saved_count');

export const options = {
    vus: 50,
    duration: "1m"
};

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
            deviceKeys.push({ api_key: res.json().key.key, imei: imei });
        }
    }
    // We pass an array of 50 objects, each will track its own 'sent' count
    return { keys: deviceKeys, startNS: startTime };
}

export default function(data) {
    const myDeviceIndex = __VU - 1;
    const myKey = data.keys[myDeviceIndex];
    const url = "ws://localhost:8883/api/live";

    // IMPORTANT: K6 VUs are isolated. We use a Counter to track total, 
    // but for individual tracking, we log to the console or use a trick.
    let mySentCount = 0;

    const res = ws.connect(url, {
        headers: { Authorization: `${myKey.imei} ${myKey.api_key}` },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const ts = Date.now() * 1000000;
                const payload = [
                    `cellular,imei=${myKey.imei} rssi=16 ${ts}`,
                    `volume,imei=${myKey.imei} vol=100 ${ts}`,
                    `firmware,imei=${myKey.imei} ver=1.0 ${ts}`,
                    `battery,imei=${myKey.imei} v=12 ${ts}`
                ].join("\n");
                
                socket.send(payload);
                mySentCount += 4; // We sent 4 records
            }, Number(__ENV.WS_MSG_INTERVAL) || 300);
        });
    });

    check(res, { "WS Connected": (r) => r && r.status === 101 });
    
    // At the end of the VU's life, we print a special string that Teardown can't see,
    // but since we know the Duration and Interval, we calculate the 'Expected' in Teardown.
}

export function teardown(data) {
    // 1. Calculate how many messages SHOULD be there
    const interval = Number(__ENV.WS_MSG_INTERVAL) || 300;
    const expectedPerDevice = Math.floor(60 / (interval / 1000)) * 4;

    let devicesFound = 0;
    let integrityPassedCount = 0;
    let totalSaved = 0;

    // 2. Retrieval Check
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${data.keys[0].api_key}` }
    });
    if (listRes.status === 200 && listRes.json().length === 50) devicesFound = 50;

    // 3. Individual Integrity Loop
    data.keys.forEach((device) => {
        const res = http.get(`http://localhost:8883/api/v1/device/measurements?imei=${device.imei}`, 
            { headers: { Authorization: `${device.api_key}` } }
        );

        if (res.status === 200) {
            const actualCount = res.json().length;
            totalSaved += actualCount;
            // Strict One-to-One Match
            if (actualCount === expectedPerDevice) integrityPassedCount++;
        }
    });

    // 4. Update Gauges for the YAML table
    gauge_devices_found.add(devicesFound);
    gauge_integrity_pass.add(integrityPassedCount);
    gauge_total_sent.add(expectedPerDevice * 50);
    gauge_total_saved.add(totalSaved);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}