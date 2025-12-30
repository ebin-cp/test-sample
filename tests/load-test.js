import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep, fail } from "k6";
import { Counter } from "k6/metrics";

const registrationCount = new Counter("registrations_total");
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(`${__ENV.WS_MSG_INTERVAL}`);

export const options = {
    vus: 50,              // 50 concurrent devices
    duration: "5m",       // Reduced to 5 minutes to save GH minutes
    thresholds: {
        registrations_total: ["count >= 50"],
        ws_metrics_sent_msgs: ["count >= 5000"],
    },
};0

const BASE_URL = "http://localhost:8883/api/v1";

export function setup() {
    const deviceKeys = [];
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post(`${BASE_URL}/device`, JSON.stringify({ imei }), {
            headers: { "Content-Type": "application/json" },
        });
        
        if (res.status !== 200) fail(`Device setup failed: ${res.status}`);
        let d = res.json();
        registrationCount.add(1);
        deviceKeys.push({ api_key: d.key.key, imei: imei });
    }
    return { keys: deviceKeys };
}

export default function(data) {
    const myKey = data.keys[__VU - 1];
    const authHeaders = {
        headers: {
            "Authorization": `${myKey.imei} ${myKey.api_key}`,
        },
    };

    // --- 1. DEVICE LIST VALIDATION ---
    const deviceListRes = http.get(`${BASE_URL}/devices`, authHeaders);
    check(deviceListRes, { 
        "Device List API OK": (r) => r.status === 200,
        "Own Device in List": (r) => r.json().some(d => d.imei === myKey.imei)
    });

    // --- 2. LOG QUERY VALIDATION ---
    const queryPayload = JSON.stringify({ imei: myKey.imei, limit: 5 });
    const logQueryRes = http.post(`${BASE_URL}/logs/query`, queryPayload, {
        headers: { ...authHeaders.headers, "Content-Type": "application/json" }
    });
    check(logQueryRes, { "Log Query API OK": (r) => r.status === 200 });

    // --- 3. WEBSOCKET MESSAGING ---
    ws.connect("ws://localhost:8883/api/live", authHeaders, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const time_str = Date.now() * 1000000;
                const cellular_log = `cellular,imei=${myKey.imei} rssi=16.56 ${time_str}`;
                socket.send(cellular_log);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
    });
    sleep(1);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}
