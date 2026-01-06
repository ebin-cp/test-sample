import http from "k6/http";
import { check } from "k6";

export function validateApiMeasurements(myKey, startTimeNS) {
    const metrics = ["volume", "cellular", "battery"];
    const now = Date.now() * 1000000;
    
    metrics.forEach((m) => {
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${myKey.imei}&measurement=${m}&start_ns=${startTimeNS}&end_ns=${now + 5000000000}`;
        const res = http.get(url, { headers: { "Authorization": `${myKey.api_key}` } });
        check(res, { [`${m} API validation`]: (r) => r.status === 200 && r.json().length > 0 });
    });
}