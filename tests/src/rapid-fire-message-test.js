import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";
import { createDevices } from "../api/device-create.js"; 
import { sendLoadMetrics } from "../websocket/ws-load.js";

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
    const startTimeNS = Date.now() * 1000000;
    const keys = createDevices(50);
    registrationCount.add(keys.length);
    return { keys: keys, startTimeNS: startTimeNS };
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