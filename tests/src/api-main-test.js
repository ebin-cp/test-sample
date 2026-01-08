import { createDevices } from "../api/device-create.js"; 
import { sendWsMetrics } from "../websocket/ws-tests.js";
import { validateApiMeasurements } from "../api/measurement-check.js";
import { generateRandomTruckData, assignTruck, deassignTruck, getDeviceDetails } from "../api/device-actions.js";
import { check, sleep } from 'k6';

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

    const truckPayload = generateRandomTruckData(myKey.imei);

    // assign and verify
    const assignRes = assignTruck(myKey.imei, myKey.api_key, truckPayload);
    check(assignRes, {"Assign Status 200":(r) => r.status === 200});

    // stream data and validate measurements
    sendWsMetrics(myKey.imei, myKey.api_key);
    sleep(45); 
    validateApiMeasurements(myKey, data.startTimeNS);

    // de-assign and verify
    const deRes = deassignTruck(myKey.imei, myKey.api_key);
    check(deRes, {"Deassign Status 200":(r) => r.status === 200});
    
    const afterDe = getDeviceDetails(myKey.imei, myKey.api_key);
    check(afterDe, {"Fields Empty": (v) => v.fields.length === 0});
}