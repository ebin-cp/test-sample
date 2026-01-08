import { createDevices } from "../api/device-create.js"; 
import { sendWsMetrics } from "../websocket/ws-tests.js";
import { validateApiMeasurements } from "../api/measurement-check.js";
import { generateRandomTruckData, assignTruck, deassignTruck, getDeviceDetails } from "../api/device-actions.js";
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        my_test: {
            executor: 'per-vu-iterations',
            vus: 50,
            iterations: 1,
            maxDuration: '3m',
        },
    },
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
    const keys = createDevices(50);
    return { keys: keys, startTimeNS: startTimeNS };
}

export default function(data) {
    if (!data || !data.keys.length) return;
    const myKey = data.keys[(__VU - 1) % data.keys.length];

    const truckPayload = generateRandomTruckData(myKey.imei);

    // 1. Assign and verify
    console.log(`[VU ${__VU}] - Assigning truck to imei: ${myKey.imei}`);
    const assignRes = assignTruck(myKey.imei, myKey.api_key, truckPayload);
    check(assignRes, {"Assign Status 200":(r) => r.status === 200});

    // 2. Stream data
    console.log(`[VU ${__VU}] - Sending WebSocket metrics...`);
    sendWsMetrics(myKey.imei, myKey.api_key);

    // 3. Wait for data to process
    console.log(`[VU ${__VU}] - Sleeping for 45s...`);
    sleep(45); 

    // 4. Validate measurements
    console.log(`[VU ${__VU}] - Checking measurements via API...`);
    validateApiMeasurements(myKey, data.startTimeNS);

    // 5. De-assign and verify
    console.log(`[VU ${__VU}] - De-assigning truck...`);
    const deRes = deassignTruck(myKey.imei, myKey.api_key);
    check(deRes, {"Deassign Status 200":(r) => r.status === 200});
    
    // 6. Final verification
    const afterDe = getDeviceDetails(myKey.imei, myKey.api_key);
    // Safe check: Fields ഉണ്ടോ എന്ന് നോക്കുക
    check(afterDe, {"Fields Empty": (v) => v && v.fields && v.fields.length === 0});
    
    console.log(`[VU ${__VU}] - Iteration completed successfully!`);
}