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
    console.log("--- Starting Final Test ---");
    
    // --- 1. Device Retrieval Audit ---
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${data.keys[0].api_key}` },
        timeout:'60s'
    });

    const is200 = listRes.status === 200;
    const listData = is200 ? listRes.json() : [];
    const isNotEmpty = listData.length > 0;
    const retrievedCount = listData.length;

    // --- 2. Measurement Endpoint Audit ---
    let successfulConns = 0;
    data.keys.forEach((device) => {
        // Individual connection check
       const url = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.startNS}&end_ns=${Date.now() * 1000000}`;

    const res = http.get(url, {
    headers: { Authorization: `${device.api_key}` },
    timeout: '60s'
});

        if (res.status === 200) {
            const rowCount = res.json().length;
            // This is the "Individual Data Count List" for the console
            console.log(`DEVICE AUDIT [${device.imei}]: Total Rows Found = ${rowCount}`);
            successfulConns++;
        } else {
            console.log(`DEVICE AUDIT [${device.imei}]: FAILED - Status ${res.status}`);
        }
    });

    // Send these values to the summary
    gauge_devices_found.add(retrievedCount); // Actual number found
    gauge_conn_success.add(successfulConns); // Number of 200 OK connections
    
    // We use a dummy gauge to pass the status of 'is200' and 'isNotEmpty'
    // 1 = Success, 0 = Failed
    const retrievalStatus = (is200 && isNotEmpty) ? 1 : 0;
    // You can also console log here for the k6 logs
    console.log(`Retrieval Status: ${is200 ? "200 OK" : "FAILED"}`);
    console.log(`Devices Found: ${retrievedCount}`);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}