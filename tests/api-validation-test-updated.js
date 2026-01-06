import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 1000;

export const options = {
    vus: 50,
    duration: "1m",
    gracefulStop: "45s", // CRITICAL: This allows the 30s sleep + API calls to finish
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
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
    return { keys: deviceKeys, startTimeNS: startTimeNS };
}

export default function(data) {
    const index = (__VU - 1) % data.keys.length;
    const myKey = data.keys[index];
    const url = "ws://localhost:8883/api/live";

    // 1. WS CONNECT & SEND DATA
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

    // 2. VALIDATION AFTER WS CLOSES (Wait for DB to sync)
    sleep(35); 

    const bufferNS = 5000 * 1000000;
    const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
    const adjustedStartNS = data.startTimeNS - bufferNS;
    const metricsToCheck = ["volume", "cellular", "firmware", "battery"];
    
    const params = { 
        headers: { 
            "Authorization": `${myKey.api_key}`,
            "Content-Type": "application/json"
        } 
    };

    let totalMessagesForThisDevice = 0;
    metricsToCheck.forEach((metric) => {
        const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${myKey.imei}&measurement=${metric}&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
        const measRes = http.get(measUrl, params);
        
        let count = 0;
        if (measRes.status === 200) {
            const body = measRes.json();
            if (Array.isArray(body)) {
                count = body.length;
                totalMessagesForThisDevice += count;
            }
        }
        check(measRes, {
            [`${metric} Data Exists (Device ${index})`]: () => count > 0,
        });
    });

    check(totalMessagesForThisDevice, {
        [`Total Messages Count for Device ${index}: ${totalMessagesForThisDevice}`]: (val) => val > 0,
    });
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data, null, 4),
    };
}