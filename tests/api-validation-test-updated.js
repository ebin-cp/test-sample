import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");

export const options = {
    vus: 50,
    duration: '40s',
};

export function setup() {
    const deviceKeys = [];
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post("http://localhost:8883/api/v1/device", 
            JSON.stringify({ imei }), { headers: { "Content-Type": "application/json" } }
        );
        if (res.status === 200) {
            const d = res.json();
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        }
    }
    if (deviceKeys.length === 0) fail("Setup failed: 0 devices created.");
    return { keys: deviceKeys };
}

export default function(data) {
    const deviceIndex = (__VU - 1) % data.keys.length;
    const myKey = data.keys[deviceIndex];
    
    const url = "ws://localhost:8883/api/live";
    const params = { headers: { Authorization: `${myKey.imei} ${myKey.api_key}` } };

    const res = ws.connect(url, params, (socket) => {
        socket.on("open", () => {
            // Send exactly 30 messages, 1 per second
            for (let i = 0; i < 30; i++) {
                const ts = Date.now() * 1000000;
                const payload = `volume,imei=${myKey.imei} v=100 ${ts}\ncellular,imei=${myKey.imei} r=-70 ${ts}\nfirmware,imei=${myKey.imei} v=1 ${ts}\nbattery,imei=${myKey.imei} l=90 ${ts}`;
                
                socket.send(payload);
                ws_metrics_sent_msgs.add(1);
                sleep(1); 
            }
            socket.close();
        });

        socket.on("error", (e) => console.log(`VU ${__VU} WS Error: ${e.error()}`));
    });

    check(res, { "WS Connected": (r) => r && r.status === 101 });

    // Wait for the ingestion to finish
    sleep(10);

    const bufferNS = 5000 * 1000000; 
        const testEndTimeNS = (Date.now() * 1000000) + bufferNS;
        const adjustedStartNS = data.startTimeNS - bufferNS;
        const metricsToCheck = ["volume", "cellular", "firmware", "battery"];
        const perDeviceResults = []; 
        console.log(`[Teardown] Starting validation for ${data.keys.length} devices...`);
        data.keys.forEach((testDevice, index) => {
            const params = { 
                headers: { 
                    "Authorization": `${testDevice.api_key}`,
                    "Content-Type": "application/json"
                } 
            };
            let totalMessagesForThisDevice = 0;
            metricsToCheck.forEach((metric) => {
                const measUrl = `http://localhost:8883/api/v1/device/measurements?imei=${testDevice.imei}&measurement=${metric}&start_ns=${adjustedStartNS}&end_ns=${testEndTimeNS}`;
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
            console.log(`[Info] Device ${testDevice.imei} total messages: ${totalMessagesForThisDevice}`); 
            perDeviceResults.push({
                imei: testDevice.imei,
                total: totalMessagesForThisDevice
            });
        });
        return { results: perDeviceResults };
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data, null, 4) };
}