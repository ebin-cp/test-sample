import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";
import * as nanoid from "https://esm.run/nanoid";
import { sendLoadMetrics } from "../websocket/ws-load.js";

const gen_imei = nanoid.customAlphabet("1234567890", 15);
const registrationCount = new Counter("registrations_total");

export const options = {
    vus: 50, 
    duration: "2m", 
    thresholds: {
        'registrations_total': ["count >= 50"],
        'ws_metrics_sent_msgs': ["count >= 10000"],
    },
};

export function setup() {
    const deviceKeys = [];
    for (let i = 0; i < 50; i++) {
        const imei = gen_imei();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };

        const res = http.post(
            "http://localhost:8883/api/v1/device",
            payload,
            params,
        );
        if (res.status !== 200 || !res.body) {
            fail(`Aborting test: Device creation failed for IMEI ${imei}`);
        }

        let d = res.json();
        if (!d.key) {
            fail(`Aborting test: No key in response for IMEI ${imei}`);
        }
        registrationCount.add(1);
        deviceKeys.push({ api_key: d.key, imei: imei });
    }
    return { keys: deviceKeys };
}

export default function(data) {
    if (!data || !data.keys) return;
    const myKey = data.keys[(__VU - 1) % data.keys.length];
    const interval = Number(__ENV.WS_MSG_INTERVAL) || 1000;
    sendLoadMetrics(myKey, interval);
    sleep(130);
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
    };
}