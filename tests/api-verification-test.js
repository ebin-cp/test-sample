import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Gauge } from "k6/metrics";

// Metric Definitions - Must match your YAML jq commands
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
    return { keys: deviceKeys, startNS: startTime };
}

export default function(data) {
    if (!data.keys || data.keys.length === 0) return;

    const myDeviceIndex = __VU - 1;
    const myKey = data.keys[myDeviceIndex % data.keys.length];
    const url = "ws://localhost:8883/api/live";

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
            }, Number(__ENV.WS_MSG_INTERVAL) || 300);
        });
    });
}

export function teardown(data) {
    if (!data || !data.keys || data.keys.length === 0) {
        console.error("No data from setup. Skipping teardown.");
        return;
    }

    // Wait for DB to settle
    console.log("Reconciliation starting... waiting 10s");
    sleep(10); 

    const interval = Number(__ENV.WS_MSG_INTERVAL) || 300;
    // Expected: (60s / (interval/1000)) * 4 metrics
    const expectedPerDevice = Math.floor(60 / (interval / 1000)) * 4;

    let devicesRetrieved = 0;
    let successfulConnections = 0;
    let integrityPassedCount = 0;
    let totalSavedCount = 0;

    // A. Device Retrieval Check
    try {
        const listRes = http.get("http://localhost:8883/api/v1/device", {
            headers: { "Authorization": `${data.keys[0].api_key}` }
        });
        if (listRes.status === 200) {
            devicesRetrieved = listRes.json().length;
        }
    } catch (e) { console.error("Device list API failed"); }

    // B. Per-Device Connection & Integrity Audit
    data.keys.forEach((device) => {
        try {
            const res = http.get(`http://localhost:8883/api/v1/device/measurements?imei=${device.imei}`, 
                { headers: { Authorization: `${device.api_key}` } }
            );

            if (res.status === 200) {
                successfulConnections++;
                const actualCount = res.json().length;
                totalSavedCount += actualCount;

                if (actualCount === expectedPerDevice) {
                    integrityPassedCount++;
                }
            }
        } catch (e) { console.error(`Failed to audit device ${device.imei}`); }
    });

    // C. Write results to Gauges
    gauge_devices_found.add(devicesRetrieved);
    gauge_conn_success.add(successfulConnections);
    gauge_integrity_pass.add(integrityPassedCount);
    gauge_total_sent.add(expectedPerDevice * 50);
    gauge_total_saved.add(totalSavedCount);

    console.log(`Teardown complete. Found ${totalSavedCount} records.`);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}