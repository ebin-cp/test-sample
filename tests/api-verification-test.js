import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Gauge } from "k6/metrics";

// Metrics for GitHub Actions Summary
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const gauge_devices_found = new Gauge('devices_found_count');
const gauge_endpoints_ok = new Gauge('endpoints_success_count');
const gauge_data_integrity = new Gauge('devices_with_data_count');

const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

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
            const d = res.json();
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        }
    }
    return { keys: deviceKeys, startNS: startTime }; 
}

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
            socket.setInterval(() => {
                const ts = Date.now() * 1000000;
                const payload = [
                    `cellular,imei=${myKey.imei} rssi=16 ${ts}`,
                    `volume,imei=${myKey.imei} vol=100 ${ts}`,
                    `firmware,imei=${myKey.imei} ver=1.0 ${ts}`,
                    `battery,imei=${myKey.imei} v=12 ${ts}`
                ].join("\n");
                
                socket.send(payload);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
    });
    check(res, { "WS Connected": (r) => r && r.status === 101 });
}

export function teardown(data) {
    if (!data || !data.keys || data.keys.length === 0) return;

    // Wait 5 seconds to let the last DB writes finish
    console.log("Waiting 5s for database synchronization...");
    sleep(5);

    const allDevices = data.keys;
    const bufferNS = 5000 * 1000000; 
    const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
    const adjustedStartNS = data.startNS - bufferNS;

    let deviceListCount = 0;
    let successfulEndpoints = 0;
    let devicesWithData = 0;
    let failedImeis = [];

    // 1. Check Global Device List
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${allDevices[0].api_key}` }
    });
    if (listRes.status === 200) deviceListCount = listRes.json().length;

    // 2. Deep Reconciliation: Check every single device
    allDevices.forEach((device) => {
        const params = { headers: { "Authorization": `${device.api_key}` } };
        const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
        
        const res = http.get(measUrl, params);

        if (res.status === 200) {
            successfulEndpoints++;
            const logs = res.json();
            if (Array.isArray(logs) && logs.length > 0) {
                devicesWithData++;
            } else {
                failedImeis.push(device.imei);
            }
        } else {
            failedImeis.push(`${device.imei} (Status: ${res.status})`);
        }
    });

    // Update Custom Gauges for GitHub YAML
    gauge_devices_found.add(deviceListCount);
    gauge_endpoints_ok.add(successfulEndpoints);
    gauge_data_integrity.add(devicesWithData);

    // Console Logging for GitHub Action Output
    console.log(`--- API Verification Report ---`);
    console.log(`Devices Created: 50 | Found: ${deviceListCount}`);
    console.log(`Endpoints OK: ${successfulEndpoints}/50`);
    console.log(`Devices with Records: ${devicesWithData}/50`);
    
    if (failedImeis.length > 0) {
        console.warn(`Critical: The following IMEIs failed validation: ${failedImeis.slice(0, 5).join(", ")}${failedImeis.length > 5 ? '...' : ''}`);
    }

    // Final Checks (Used for Exit Code)
    check(deviceListCount, { "API: Device List Count Match": (v) => v === 50 });
    check(successfulEndpoints, { "API: All Endpoints 200": (v) => v === 50 });
    check(devicesWithData, { "API: All Devices Have Data": (v) => v === 50 });
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
    };
}