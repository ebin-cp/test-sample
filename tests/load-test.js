import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m",
    // thresholds: {
    //     // Now this threshold has a metric to watch!
    //     "registrations_total": ["count >= 50"],
    //     "ws_metrics_sent_msgs": ["count >= 10000"],
    //     "checks": ["rate > 0.9"],
    // },
};

// Global variable to capture test start time for the query range
const testStartTimeNS = Date.now() * 1000000;

export function setup() {
    const deviceKeys = [];
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post("http://localhost:8883/api/v1/device", 
            JSON.stringify({ imei }), 
            { headers: { "Content-Type": "application/json" } }
        );
        if (res.status === 200) {
            const d = res.json();
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        }
    }
    return { keys: deviceKeys };
}

export default function(data) {
    const myKey = data.keys[(__VU - 1) % data.keys.length];
    const url = "ws://localhost:8883/api/live";

    const res = ws.connect(url, {
        headers: {
            Origin: "robad.in",
            Authorization: `${myKey.imei} ${myKey.api_key}`,
        },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const ts = Date.now() * 1000000;
                const payload = [
                    `cellular,imei=${myKey.imei} rssi=16 ${ts}`,
                    `volume,imei=${myKey.imei} vol=100 ${ts}`,
                    `firmware,imei=${myKey.imei} ver=1.0 ${ts}`,
                    `battery,imei=${myKey.imei} v=12 ${ts}`
                ].join("\n");
                
                socket.send(payload);
                ws_metrics_sent_msgs.add(1);
            }, ws_msg_interval);
        });
    });
    check(res, { "WS Connected": (r) => r && r.status === 101 });
}

export function teardown(data) {
    const testDevice = data.keys[0];
    // Add a 5-second buffer (in nanoseconds) to ensure we capture all data
    const bufferNS = 5000 * 1000000; 
    const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
    const adjustedStartNS = testStartTimeNS - bufferNS;

    const params = { 
        headers: { 
            "Authorization": `${testDevice.api_key}`,
            "Content-Type": "application/json"
        } 
    };

    // 1. Verify GET Device List
    const listRes = http.get("http://localhost:8883/api/v1/device", params);
    check(listRes, { "API: Device List 200": (r) => r.status === 200 });

    // 2. Verify GET Measurements
    // Note: Ensure 'volume' matches exactly what your backend expects
    const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${testDevice.imei}&measurement=volume&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
    const measRes = http.get(measUrl, params);
    
    const measPass = check(measRes, {
        "API: Measurements 200": (r) => r.status === 200,
        "API: Measurements Has Data": (r) => r.json() && r.json().length > 0,
    });

    // If it fails, print the details to the GitHub Action logs
    if (!measPass) {
        console.log(`--- API DEBUG INFO ---`);
        console.log(`Status: ${measRes.status}`);
        console.log(`URL: ${measUrl}`);
        console.log(`Body: ${measRes.body}`);
        console.log(`----------------------`);
    }
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
        "stdout": JSON.stringify(data, null, 2),
    };
}