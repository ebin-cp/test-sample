import http from "k6/http";
import { sleep } from "k6";
import { sendWsMetrics } from "./websocket/ws-tests.js"; 
import { validateApiMeasurements } from "./api/api-tests.js";

export const options = {
    vus: 50,
    duration: '1m',
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
    const deviceKeys = [];
    for (let i = 0; i < 50; i++) {
        const imei = Math.floor(Math.random() * 1000000000000000).toString();
        const res = http.post("http://localhost:8883/api/v1/device", JSON.stringify({ imei }), { 
            headers: { "Content-Type": "application/json" } 
        });
        if (res.status === 200 || res.status === 201) {
            const d = res.json();
            const apiKey = d.key?.key || d.key || null;
            if (apiKey) deviceKeys.push({ api_key: apiKey, imei: imei });
        }
    }
    return { keys: deviceKeys, startTimeNS: startTimeNS };
}

export default function(data) {
    if (!data || !data.keys.length) return;
    const myKey = data.keys[(__VU - 1) % data.keys.length];

    sendWsMetrics(myKey.imei, myKey.api_key);
    sleep(45); 
    validateApiMeasurements(myKey, data.startTimeNS);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data, null, 4) };
}