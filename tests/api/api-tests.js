import http from "k6/http";
import { check } from "k6";

export function validateApiMeasurements(myKey, startTimeNS) {
    const metricsToCheck = ["volume", "cellular", "firmware", "battery"];
    const bufferNS = 5000 * 1000000;
    const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
    const adjustedStartNS = startTimeNS - bufferNS;

    metricsToCheck.forEach((metric) => {
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${myKey.imei}&measurement=${metric}&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
        const res = http.get(url, { headers: { "Authorization": `${myKey.api_key}` } });
        
        let count = 0;
        if (res.status === 200) {
            const body = res.json();
            count = Array.isArray(body) ? body.length : 0;
        }

        check(res, { 
            [`${metric} API Check`]: (r) => r.status === 200,
            [`${metric} Data Saved`]: () => count > 0 
        });
    });
}