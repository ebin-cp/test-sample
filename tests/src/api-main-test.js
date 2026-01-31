import { createDevices } from "../api/device-create.js"; 
import { sendWsMetrics } from "../websocket/ws-measurement.js";
import { validateApiMeasurements } from "../api/measurement-check.js";
import { generateRandomTruckData, assignTruck, deassignTruck, getDeviceDetails } from "../api/device-actions.js";
import { verifyVolumeMapping } from "../websocket/ws-calibration-verify.js";
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        my_test: {
            executor: 'per-vu-iterations',
            vus: 75,
            iterations: 1,
            maxDuration: '2m', 
        },
    },
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
    const keys = createDevices(75);
    return { keys: keys, startTimeNS: startTimeNS };
}

export default function(data) {
    if (!data || !data.keys.length) return;
    const myKey = data.keys[(__VU - 1) % data.keys.length];
    const truckPayload = generateRandomTruckData(myKey.imei);

    // 1. Assign
    const assignRes = assignTruck(myKey.imei, myKey.api_key, truckPayload);
    check(assignRes, {"Assign Status 200":(r) => r.status === 200});
    sleep(0.5)

    //volume-mapping
    console.log(`[VU ${__VU}] - Verifying Volume Mapping via WS SYNC...`);
    verifyVolumeMapping(myKey.imei, myKey.api_key, truckPayload);

    // 2. Stream Metrics (Starts 1 minute streaming)
    sendWsMetrics(myKey.imei, myKey.api_key);

    // 3. Wait for Stream completion
    console.log(`[VU ${__VU}] - Streaming data, waiting 65s...`);
    sleep(65); 

    // 4. De-assign
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