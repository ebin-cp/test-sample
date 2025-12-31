import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { sleep } from "k6";
import { Gauge, Counter } from "k6/metrics";

const gauge_devices_found = new Gauge('devices_found_count');
const gauge_conn_success = new Gauge('connections_success_count');
const gauge_total_saved = new Gauge('total_saved_count');
const count_sent_msgs = new Counter('total_sent_msgs');

export const options = {
    vus: 50,
    duration: "1m" // 1 minute test as requested
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
    const deviceKeys = [];
    // 1. Create 50 devices dynamically
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
    if (!myKey) return;

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
                count_sent_msgs.add(1); // Track bundles sent
            }, Number(__ENV.WS_MSG_INTERVAL) || 10000); // Default 10s
        });
        
        socket.setTimeout(() => socket.close(), 60000);
    });
}

export function teardown(data) {
    console.log("--- Starting Data Integrity Audit ---");
    sleep(5); // Grace period for DB persistence
    
    const endNS = Date.now() * 1000000;
    let totalDbRowsFound = 0;
    let successfulConns = 0;

    // 1. Device Retrieval Test (GET /api/v1/device)
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${data.keys[0].api_key}` }
    });
    gauge_devices_found.add(listRes.status === 200 ? listRes.json().length : 0);

    // 2. Individual Device Measurement Check
    data.keys.forEach((device) => {
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.startNS}&end_ns=${endNS}`;
        const res = http.get(url, { headers: { Authorization: `${device.api_key}` } });

        if (res.status === 200) {
            const rowCount = res.json().length;
            console.log(`IMEI: ${device.imei} | Sent: ~6 | Found in DB: ${rowCount}`);
            successfulConns++;
            totalDbRowsFound += (rowCount * 4); // Multiplying by 4 as each bundle has 4 metrics
        }
    });

    gauge_conn_success.add(successfulConns);
    gauge_total_saved.add(totalDbRowsFound);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}