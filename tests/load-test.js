import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: 50,
    duration: '1m',
    summaryTrendStats: ['avg', 'p(95)', 'max'],
};

const testStartTimeNS = Date.now() * 1000000;

export function setup() {
    const devices = [];
    for (let i = 0; i < 50; i++) {
        devices.push({
            imei: `IMEI_${Math.random().toString(36).substring(7)}_${i}`,
            api_key: `key_${i}`
        });
    }
    return { keys: devices };
}

export default function (data) {
    const device = data.keys[__VU - 1];
    const interval = __ENV.WS_MSG_INTERVAL || 300;
    
    // Simulate telemetry ingestion
    sleep(interval / 1000);
}

export function teardown(data) {
    const testDevice = data.keys[0]; 
    const bufferNS = 5000 * 1000000; 
    const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
    const adjustedStartNS = testStartTimeNS - bufferNS;

    const params = { 
        headers: { 
            "Authorization": `${testDevice.api_key}`,
            "Content-Type": "application/json"
        } 
    };

    // 1. Device List Retrieval
    const listRes = http.get("http://localhost:8883/api/v1/device", params);
    let deviceCountFound = 0;
    if (listRes.status === 200) {
        deviceCountFound = JSON.parse(listRes.body).length;
    }
    console.log(`[RESULT_DEVICES]: ${deviceCountFound}`);

    // 2. Measurements Retrieval
    const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${testDevice.imei}&measurement=volume&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
    const measRes = http.get(measUrl, params);
    let logsFound = 0;
    if (measRes.status === 200) {
        logsFound = JSON.parse(measRes.body).length;
    }
    console.log(`[RESULT_LOGS]: ${logsFound}`);

    check(listRes, { "API: Device List 200": (r) => r.status === 200 });
    check(measRes, { 
        "API: Measurements 200": (r) => r.status === 200,
        "API: Measurements Has Data": (r) => logsFound > 0 
    });
}