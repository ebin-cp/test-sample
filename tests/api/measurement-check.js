import http from "k6/http";
import { check } from "k6";

export function validateApiMeasurements(myKey, startTimeNS) {
    const metricsToCheck = ["volume", "cellular", "firmware", "battery"];
    const bufferNS = 5000 * 1000000;
    const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
    const adjustedStartNS = startTimeNs - bufferNS;

    metricsToCheck.forEach((metric) => {
        const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${myKey.imei}&measurement=${metric}&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
        const measRes = http.get(measUrl, { headers: { "Authorization": `${myKey.api_key}` } });
        
        let count = 0;
        if (measRes.status === 200) {
            const body = measRes.json();
            count = Array.isArray(body) ? body.length : 0;
        }
        check(measRes, { [`${metric} Data Saved`]: () => count > 0 });
    });
}