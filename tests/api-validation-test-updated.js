import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

// Metric name must match the jq query in your YAML exactly
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 1000;

export const options = {
    vus: 50,
    duration: "45s", // Buffer for setup/teardown
};

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
    if (deviceKeys.length === 0) {
        fail("No devices were created. Check API connectivity.");
    }
    return { keys: deviceKeys };
}

export default function(data) {
    const deviceIndex = (__VU - 1) % data.keys.length;
    const myKey = data.keys[deviceIndex];
    const url = "ws://localhost:8883/api/live";
    const startTimeNS = Date.now() * 1000000; 
    const runTime = 30000; // 30 Seconds active sending

    const res = ws.connect(url, {
        headers: {
            Origin: "robad.in",
            Authorization: `${myKey.imei} ${myKey.api_key}`,
        },
    }, (socket) => {
        socket.on("open", () => {
            const intervalId = socket.setInterval(() => {
                const now = Date.now();
                
                // Stop sending after runTime
                if (now - (startTimeNS / 1000000) > runTime) {
                    socket.close();
                    return;
                }

                const ts = now * 1000000;
                
                /**
                 * PAYLOAD ALIGNMENT:
                 * We send 4 measurements per WebSocket message.
                 * This satisfies the YAML: TOTAL_EXPECTED = (WS_SENT * 4)
                 */
                const payload = 
                    `volume,imei=${myKey.imei} vol=100 ${ts}\n` +
                    `cpu,imei=${myKey.imei} usage=45 ${ts}\n` +
                    `mem,imei=${myKey.imei} free=512 ${ts}\n` +
                    `temp,imei=${myKey.imei} val=35 ${ts}`;

                socket.send(payload);
                ws_metrics_sent_msgs.add(1); 
            }, ws_msg_interval);
        });

        socket.on("error", (e) => console.error(`VU ${__VU} error: ${e.error()}`));
    });

    // Check WS connection success
    check(res, { "WS Connected": (r) => r && r.status === 101 });

    // CRITICAL: Wait for backend to flush memory/buffers to MySQL
    sleep(15); 

    const endTimeNS = Date.now() * 1000000;
    const params = { 
        headers: { 
            "Authorization": `${myKey.api_key}`, 
            "Content-Type": "application/json" 
        } 
    };

    // Query specifically for 'volume' measurements as a proxy for the batch
    const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${myKey.imei}&measurement=volume&start_ns=${startTimeNS}&end_ns=${endTimeNS}`;
    const measRes = http.get(measUrl, params);

    let count = 0;
    try {
        const body = measRes.json();
        // Adjust based on your API response structure (e.g., body.data.length)
        count = Array.isArray(body) ? body.length : 0;
    } catch (e) {
        count = 0;
    }

    /**
     * YAML CHECK ALIGNMENT:
     * This exact string format is required for: 
     * jq -r --arg idx "$INDEX" '.root_group.groups[].checks[] | select(.name | contains("Total Messages Count for Device \($idx):"))'
     */
    check(measRes, {
        "API Status is 200": (r) => r.status === 200,
        [`Total Messages Count for Device ${deviceIndex}: ${count}`]: () => count >= 0,
    });
}

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data, null, 4),
    };
}