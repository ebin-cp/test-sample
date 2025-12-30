import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const registrationCount = new Counter("registrations_total");
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const device_list_passes = new Counter("device_list_passes");
const log_validation_passes = new Counter("log_validation_passes");

const ws_msg_interval = Number(`${__ENV.WS_MSG_INTERVAL}`);
const BASE_URL = "http://localhost:8883/api/v1";

export const options = {
    vus: 50,
    duration: "1m", // Set to 1 minute as requested
    thresholds: {
        registrations_total: ["count >= 50"],
        device_list_passes: ["count >= 50"],
        log_validation_passes: ["count >= 50"],
    },
};

export function setup() {
    const deviceKeys = [];
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post(`${BASE_URL}/device`, JSON.stringify({ imei }), {
            headers: { "Content-Type": "application/json" },
        });
        if (res.status !== 200) fail(`Setup failed for IMEI ${imei}`);
        let d = res.json();
        registrationCount.add(1);
        deviceKeys.push({ api_key: d.key.key, imei: imei });
    }
    return { keys: deviceKeys };
}

export default function(data) {
    const myKey = data.keys[__VU - 1];
    const authHeaders = {
        headers: { "Authorization": `${myKey.imei} ${myKey.api_key}` },
    };

    // --- TEST 1: DEVICE LIST VALIDATION ---
    const deviceListRes = http.get(`${BASE_URL}/devices`, authHeaders);
    const listOk = check(deviceListRes, {
        "Device found in list": (r) => r.json().some(d => d.imei === myKey.imei),
    });
    if (listOk) device_list_passes.add(1);

    // --- TEST 2: WEBSOCKET INGESTION ---
    const url = "ws://localhost:8883/api/live";
    ws.connect(url, { headers: { Origin: "robad.in", ...authHeaders.headers } }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const time_str = Date.now() * 1000000;
                // Sending specific RSSI 16.56 to verify later
                const cellular_log = `cellular,imei=${myKey.imei} rssi=16.56 ${time_str}`;
                const volume_log = `volume,imei=${myKey.imei} sensorValue=6 ${time_str}`;
                socket.send([cellular_log, volume_log].join("\n"));
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
        // Run WS for 40 seconds then close to allow the final validation check
        socket.setTimeout(() => socket.close(), 40000);
    });

    // Short sleep to ensure the last message is written to DB
    sleep(5);

    // --- TEST 3: DATA INTEGRITY VALIDATION ---
    const queryPayload = JSON.stringify({ imei: myKey.imei, limit: 1 });
    const logQueryRes = http.post(`${BASE_URL}/logs/query`, queryPayload, {
        headers: { ...authHeaders.headers, "Content-Type": "application/json" }
    });

    const lastLogs = logQueryRes.json();
    const dataOk = check(logQueryRes, {
        "Query Successful": (r) => r.status === 200,
        "Correct IMEI in DB": (r) => lastLogs.length > 0 && lastLogs[0].imei === myKey.imei,
        "Correct Value in DB": (r) => lastLogs[0].rssi === 16.56 || lastLogs[0].sensorValue === 6
    });
    if (dataOk) log_validation_passes.add(1);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}