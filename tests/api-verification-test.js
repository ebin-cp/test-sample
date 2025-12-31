import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { sleep } from "k6";
import { Gauge } from "k6/metrics";

const gauge_devices_found = new Gauge('devices_found_count');
const gauge_conn_success = new Gauge('connections_success_count');
const gauge_integrity_pass = new Gauge('integrity_passed_count');
const gauge_total_saved = new Gauge('total_saved_count');

export const options = {
    vus: 50,
    duration: "1m"
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
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
    return { keys: deviceKeys, startNS: startTimeNS };
}

export default function(data) {
    const myKey = data.keys[__VU - 1];
    ws.connect("ws://localhost:8883/api/live", {
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
    console.log("Waiting 10s for database synchronization...");
    sleep(10); 

    const endTimeNS = Date.now() * 1000000;
    const interval = Number(__ENV.WS_MSG_INTERVAL) || 300;
    
    // We expect 1 'volume' record per interval. 
    // Calculation: 60 seconds / (interval in seconds)
    const expectedPerMeasurement = Math.floor(60 / (interval / 1000));

    let devicesFound = 0;
    let successfulConns = 0;
    let integrityPassed = 0;
    let totalVolumeRecords = 0;

    // 1. Device Retrieval Test (Requirement: Status 200 & Not Empty)
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${data.keys[0].api_key}` }
    });
    if (listRes.status === 200 && listRes.json().length > 0) {
        devicesFound = listRes.json().length;
    }

    // 2. Individual Device Audit Loop (Requirement: Every device is not empty & count matches)
    data.keys.forEach((device) => {
        // Constructing your specific URL
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.startNS}&end_ns=${endTimeNS}`;
        
        const res = http.get(url, {
            headers: { "Authorization": `${device.api_key}` }
        });

        if (res.status === 200) {
            successfulConns++;
            const records = res.json();
            const count = Array.isArray(records) ? records.length : 0;
            totalVolumeRecords += count;

            // Simple Integrity: Not empty AND matches expected count
            if (count > 0 && count >= expectedPerMeasurement) {
                integrityPassed++;
            } else {
                console.warn(`⚠️ Device ${device.imei} incomplete: Found ${count}, Expected ${expectedPerMeasurement}`);
            }
        }
    });

    gauge_devices_found.add(devicesFound);
    gauge_conn_success.add(successfulConns);
    gauge_integrity_pass.add(integrityPassed);
    gauge_total_saved.add(totalVolumeRecords);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}