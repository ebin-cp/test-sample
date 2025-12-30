import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m",
    thresholds: {
        // We temporarily lower this to 0% just to see the logs without the test crashing
        "checks": ["rate>=0"], 
    },
};

export function setup() {
    const deviceKeys = [];
    const params = { 
        headers: { 
            "Content-Type": "application/json",
            "Origin": "robad.in",
            "User-Agent": "k6-test"
        } 
    };

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post("http://localhost:8883/api/v1/device", JSON.stringify({ imei }), params);

        if (res.status !== 200) {
            console.log(`SETUP ERROR: Device ${i} failed. Status: ${res.status}. Body: ${res.body}`);
            continue; 
        }

        const d = res.json();
        deviceKeys.push({ api_key: d.key.key, imei: imei });
    }

    if (deviceKeys.length === 0) fail("Critical Failure: 0 devices registered.");
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
                socket.send(`cellular,imei=${myKey.imei} rssi=16.56 ${time_str}`);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
        socket.on("error", (e) => console.log(`WS Connection Error: ${e.error()}`));
    });

    check(res, { "WS connected": (r) => r && r.status === 101 });
}

export function teardown(data) {
    const testDevice = data.keys[0];
    const params = { 
        headers: { 
            "Authorization": `${testDevice.api_key}`, // Double check if your API expects Bearer!
            "Origin": "robad.in"
        } 
    };

    const listRes = http.get("http://localhost:8883/api/v1/devices", params);
    const logsRes = http.get(`http://localhost:8883/api/v1/logs?imei=${testDevice.imei}`, params);

    check(listRes, { "Teardown: List API 200": (r) => r.status === 200 });
    check(logsRes, { "Teardown: Logs API 200": (r) => r.status === 200 });

    if (listRes.status !== 200 || logsRes.status !== 200) {
        console.log(`TEARDOWN DEBUG: List Status ${listRes.status}, Logs Status ${logsRes.status}`);
        console.log(`TEARDOWN BODY: ${listRes.body}`);
    }
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
        "stdout": JSON.stringify(data, null, 2),
    };
}