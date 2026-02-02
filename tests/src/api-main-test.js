import { createDevices } from "../api/device-create.js";
import { sendWsMetrics } from "../websocket/ws-measurement.js";
import { validateApiMeasurements } from "../api/measurement-check.js";
import { generateRandomTruckData, assignTruck, deassignTruck, getDeviceDetails, assignFirmwareUrl, generateRandomFWUrl } from "../api/device-actions.js";
import { verifyFirmwareUrl, verifyVolumeMapping } from "../websocket/ws-calibration-verify.js";
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        my_test: {
            executor: 'per-vu-iterations',
            vus: 70,
            iterations: 1,
            maxDuration: '5m',
        },
    },
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
    const keys = createDevices(70);
    return { keys: keys, startTimeNS: startTimeNS };
}

export default function (data) {
    if (!data || !data.keys.length) return;
    const myKey = data.keys[(__VU - 1) % data.keys.length];
    const truckPayload = generateRandomTruckData(myKey.imei);

    const assignRes = assignTruck(myKey.imei, myKey.api_key, truckPayload);
    check(assignRes, { "Assign Status 200": (r) => r.status === 200 });
    sleep(0.5)

    console.log(`[VU ${__VU}] - Verifying Volume Mapping via WS SYNC...`);
    verifyVolumeMapping(myKey.imei, myKey.api_key);

    sendWsMetrics(myKey.imei, myKey.api_key);

    console.log(`[VU ${__VU}] - Streaming data, waiting 65s...`);
    sleep(65);

    console.log(`[VU ${__VU}] - De-assigning truck...`);
    const deRes = deassignTruck(myKey.imei, myKey.api_key);
    check(deRes, { "Deassign Status 200": (r) => r.status === 200 });

    validateApiMeasurements(myKey, data.startTimeNS);

    const afterDe = getDeviceDetails(myKey.imei, myKey.api_key);
    check(afterDe, { "Fields Empty": (v) => v?.fields && v.fields.length === 0 });

    const fw_url_payload = generateRandomFWUrl(myKey.imei);

    console.log(`[VU ${__VU}] - Assigning Firmware URL via WS SYNC...`);
    const assignFWRes = assignFirmwareUrl(myKey.imei, myKey.api_key, fw_url_payload);
    check(assignFWRes, { "Assign Status 200": (r) => r.status === 200 });
    sleep(0.5)

    console.log(`[VU ${__VU}] - Verifying Firmware URL via WS SYNC...`);
    verifyFirmwareUrl(myKey.imei, myKey.api_key, fw_url_payload);

    console.log(`[VU ${__VU}] - DONE!`);
}
