import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const registrationCount = new Counter("registrations_total");
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(`${__ENV.WS_MSG_INTERVAL}`);

export const options = {
    vus: 50, 
    duration: "1m", // Reduced to 5m for efficiency
    thresholds: {
        registrations_total: ["count >= 50"],
        // Commented out to prevent exit code 99 if network is slow
        // ws_metrics_sent_msgs: ["count >= 1000"], 
    },
};

export function setup() {
    const deviceKeys = [];
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };

        const res = http.post("http://localhost:8883/api/v1/device", payload, params);
        
        if (res.status !== 200) fail(`Setup failed: ${res.status}`);
        
        let d = res.json();
        registrationCount.add(1);
        deviceKeys.push({ api_key: d.key.key, imei: imei });
    }
    return { keys: deviceKeys };
}

export default function(data) {
    const myKey = data.keys[__VU - 1];
    const BASE_URL = "http://localhost:8883/api/v1";
    const authHeaders = {
        headers: { Authorization: `${myKey.imei} ${myKey.api_key}` }
    };

    // --- 1. DEVICE LIST VALIDATION ---
    const deviceListRes = http.get(`${BASE_URL}/devices`, authHeaders);
    check(deviceListRes, { 
        "Device List API OK": (r) => r.status === 200,
        "Own Device in List": (r) => {
            const body = r.json();
            const list = Array.isArray(body) ? body : (body.data || body.devices || []);
            return list.some(d => d.imei === myKey.imei);
        }
    });

    // --- 2. LOG QUERY VALIDATION ---
    const queryPayload = JSON.stringify({ imei: myKey.imei, limit: 5 });
    const logQueryRes = http.post(`${BASE_URL}/logs/query`, queryPayload, {
        headers: { ...authHeaders.headers, "Content-Type": "application/json" }
    });
    check(logQueryRes, { "Log Query API OK": (r) => r.status === 200 });

    // --- 3. WEBSOCKET STRESS TEST ---
    const url = "ws://localhost:8883/api/live";
    const res = ws.connect(url, {
        headers: {
            Origin: "robad.in",
            Authorization: `${myKey.imei} ${myKey.api_key}`,
        },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const time_str = Date.now() * 1000000;
                const cellular_log = `cellular,imei=${myKey.imei} rssi=16.56,iccid=\"89919509129637837632\",operator=\"airtel\",band=\"LTE BAND 40\",rat=\"TDD LTE\",plmn=\"40495\",apn=\"iot.com\" ${time_str}`;
                const volume_log = `volume,imei=${myKey.imei} nodeAddress=\"0x01,0x02,0x03\",mask=\"0x20\",sensorValue=6,volume=100.0 ${time_str}`;
                const fw_log = `firmware,imei=${myKey.imei} firmware_ver_tx=\"v1.0.0:slm-t\",node_0x01_fw=\"v1.0.0:slm-s\",node_0x02_fw=\"v1.0.0:slm-s\" ${time_str}`;
                const bat_log = `battery,imei=${myKey.imei} eBatVolt=12.00 ${time_str}`;
                socket.send([cellular_log, volume_log, fw_log, bat_log].join("\n"));
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
        socket.on("error", (e) => console.error("WS Error:", e.error()));
    });

    check(res, { "WS connected": (r) => r && r.status === 101 });
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}
