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
            maxDuration: '2m', // Corrected duration
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

    // 1. Assign
    const assignRes = assignTruck(myKey.imei, myKey.api_key, truckPayload);
    check(assignRes, {"Assign Status 200":(r) => r.status === 200});

    // 2. Stream Metrics
    sendWsMetrics(myKey.imei, myKey.api_key);

    // 3. Short Sleep
    console.log(`[VU ${__VU}] - Short sleep for 10s...`);
    sleep(10); 

    // 4. De-assign (Ithu ippo ivide idunnu so summary-il result kittum)
    console.log(`[VU ${__VU}] - De-assigning truck...`);
    const deRes = deassignTruck(myKey.imei, myKey.api_key);
    check(deRes, {"Deassign Status 200":(r) => r.status === 200});

    // 5. Validation
    validateApiMeasurements(myKey, data.startTimeNS);
    
    // 6. Final verification
    const afterDe = getDeviceDetails(myKey.imei, myKey.api_key);
    check(afterDe, {"Fields Empty": (v) => v && v.fields && v.fields.length === 0});
    
    console.log(`[VU ${__VU}] - DONE!`);
}