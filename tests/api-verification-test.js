import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

export const options = {
    vus: 50,
    duration: "1m"
};

export function setup() {
    // FIX 1: Capture start time here
    const startTime = Date.now() * 1000000; 
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
    // FIX 2: You MUST return startNS so teardown can use it
    return { keys: deviceKeys, startNS: startTime }; 
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
    if (!data || !data.keys || data.keys.length === 0) return;

    const testDevice = data.keys[0];
    // FIX 3: Correctly pull startNS from the data object
    const testStartTimeNS = data.startNS; 
    const bufferNS = 5000 * 1000000; 
    const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
    const adjustedStartNS = testStartTimeNS - bufferNS;

    const params = { 
        headers: { 
            "Authorization": `${testDevice.api_key}`,
            "Content-Type": "application/json"
        } 
    };

    // 1. Check Device List
    const listRes = http.get("http://localhost:8883/api/v1/device", params);

    // 2. Check Measurements
    const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${testDevice.imei}&measurement=volume&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
    const measRes = http.get(measUrl, params);
    
    // Checks
    check(listRes, { "API: Device List 200": (r) => r.status === 200 });
    check(measRes, {
        "API: Measurements 200": (r) => r.status === 200,
        "API: Measurements Has Data": (r) => {
            const body = r.json();
            const hasData = Array.isArray(body) && body.length > 0;
            if (!hasData) console.warn(`⚠️ FAIL: No records found for ${testDevice.imei} between ${adjustedStartNS} and ${testEndTimeNS}`);
            return hasData;
        },
    });
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
    };
}