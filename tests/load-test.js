import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const registrationCount = new Counter("registrations_total");
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m",
    thresholds: {
        registrations_total: ["count >= 50"],
    },
};

export function setup() {
    const deviceKeys = [];
    const url = "http://localhost:8883/api/v1/device";

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };

        let res = http.post(url, payload, params);

        // RETRY LOGIC: If we get a 502, wait 3 seconds and try one more time
        if (res.status === 502) {
            console.log(`Device ${i} got 502. Retrying...`);
            sleep(3);
            res = http.post(url, payload, params);
        }

        if (res.status !== 200) {
            fail(`Setup failed at device ${i}: ${res.status}. Body: ${res.body}`);
        }

        const d = res.json();
        registrationCount.add(1);
        deviceKeys.push({ api_key: d.key.key, imei: imei });
    }
    return { keys: deviceKeys };
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
                const time_str = Date.now() * 1000000;
                const logs = `cellular,imei=${myKey.imei} rssi=16.56 ${time_str}`;
                socket.send(logs);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
    });

    check(res, { "connected": (r) => r && r.status === 101 });
}

export function teardown(data) {
    const testDevice = data.keys[0];
    const params = { headers: { "Authorization": `${testDevice.api_key}` } };

    // API Verification: List
    const listRes = http.get("http://localhost:8883/api/v1/devices", params);
    check(listRes, { "API: List Status 200": (r) => r.status === 200 });

    // API Verification: Logs
    const logRes = http.get(`http://localhost:8883/api/v1/logs?imei=${testDevice.imei}`, params);
    check(logRes, { "API: Logs Status 200": (r) => r.status === 200 });
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
        "stdout": JSON.stringify(data, null, 2),
    };
}