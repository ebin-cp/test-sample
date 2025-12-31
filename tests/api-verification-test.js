import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m"
};

export function setup() {
    // FIX 1: Capture start time here
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
    // FIX 2: You MUST return startNS so teardown can use it
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
    const allDevices = data.keys;
    const testStartTimeNS = data.startNS;
    const bufferNS = 5000 * 1000000; 
    const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
    const adjustedStartNS = testStartTimeNS - bufferNS;

    // Reporting Variables
    let deviceListCount = 0;
    let successfulEndpoints = 0;
    let devicesWithData = 0;
    let totalRowsInDB = 0;
    let devicesWithMismatch = [];

    // 1. Check Global Device List
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${allDevices[0].api_key}`, "Content-Type": "application/json" }
    });
    
    if (listRes.status === 200) {
        deviceListCount = listRes.json().length;
    }

    // 2. Loop through ALL devices to check Endpoints and Data Counts
    allDevices.forEach((device) => {
        const params = { headers: { "Authorization": `${device.api_key}` } };
        const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
        
        const res = http.get(measUrl, params);

        if (res.status === 200) {
            successfulEndpoints++;
            const logs = res.json();
            const count = logs.length;
            totalRowsInDB += count;

            if (count > 0) {
                devicesWithData++;
            } else {
                devicesWithMismatch.push(device.imei); // Track which device is empty
            }
        }
    });

    // Console Output for GitHub Logs
    console.log(`[Reconciliation Report]`);
    console.log(`- Devices Created: 50 | Retrievable: ${deviceListCount}`);
    console.log(`- Endpoint 200 OK: ${successfulEndpoints}/50`);
    console.log(`- Devices with Data: ${devicesWithData}/50`);
    console.log(`- Total Data Points Found: ${totalRowsInDB}`);
    if (devicesWithMismatch.length > 0) {
        console.log(`- FAILED IMEIs (Empty): ${devicesWithMismatch.join(", ")}`);
    }

    // Final Checks for the YAML to read
    check(listRes, { "API: Device List Count Match": () => deviceListCount === 50 });
    check(successfulEndpoints, { "API: All Endpoints 200": (val) => val === 50 });
    check(devicesWithData, { "API: All Devices Have Data": (val) => val === 50 });
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
    };
}