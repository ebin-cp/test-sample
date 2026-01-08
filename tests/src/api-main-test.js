import { createDevices } from "../api/device-create.js"; // Updated filename
import { sendWsMetrics } from "../websocket/ws-tests.js";
import { validateApiMeasurements } from "../api/measurement-check.js";
import { sleep } from 'k6';

export const options = {
    vus: 50,
    duration: '1m',
    gracefulStop: '30s',
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
    const keys = createDevices(50);
    return { keys: keys, startTimeNS: startTimeNS };
}

export default function(data) {
    if (!data || !data.keys.length) return;
    const myKey = data.keys[(__VU - 1) % data.keys.length];

    sendWsMetrics(myKey.imei, myKey.api_key);
    sleep(45); 
    validateApiMeasurements(myKey, data.startTimeNS);
}