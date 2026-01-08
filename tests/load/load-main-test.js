import { createDevices } from "./api/device-create.js"; 
import { sendLoadMetrics } from "../websocket/ws-load.js"; 
import { sleep } from 'k6';

export const options = {
    scenarios: {
        load_test: {
            executor: 'per-vu-iterations',
            vus: 50,
            iterations: 1,
            maxDuration: '4m',
        },
    },
};

export function setup() {
    return { keys: createDevices(50) };
}

export default function(data) {
    if (!data || !data.keys.length) return;

    const myKey = data.keys[(__VU - 1) % data.keys.length];
    const interval = Number(__ENV.WS_MSG_INTERVAL) || 1000;
    const duration = 120000; // 2 minutes

    sendLoadMetrics(myKey.imei, myKey.api_key, interval, duration);
}