import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Gauge, Counter } from "k6/metrics";

// Metrics definitions
const gauge_devices_found = new Gauge('devices_found_count');
const gauge_conn_success = new Gauge('connections_success_count');
const gauge_total_sent = new Counter('total_sent_count'); // Total WS messages sent

export const options = {
    vus: 50,
    duration: "1m"
};

export function setup() {
    const deviceKeys = [];

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post("http://localhost:8883/api/v1/device", 
            JSON.stringify({ imei }), 
            { headers: { "Content-Type": "application/json" } }
        );
        if (res.status === 200 && res.json().key) {
            deviceKeys.push({ api_key: res.json().key.key, imei });
        }
    }

    gauge_devices_found.add(deviceKeys.length);

    return { keys: deviceKeys };
}

export default function(data) {
    if (!data.keys || data.keys.length === 0) return;

    const myDeviceIndex = __VU - 1;
    const myKey = data.keys[myDeviceIndex % data.keys.length];
    const url = "ws://localhost:8883/api/live";

    ws.connect(url, { headers: { Authorization: `${myKey.imei} ${myKey.api_key}` } }, (socket) => {
        let sentCount = 0;

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
                sentCount += 4; // 4 messages per interval
                gauge_total_sent.add(4);
            }, Number(__ENV.WS_MSG_INTERVAL) || 300);
        });

        socket.on("close", () => {
            console.log(`Device ${myKey.imei} sent ${sentCount} messages`);
        });
    });
}

export function teardown(data) {
    if (!data.keys || data.keys.length === 0) {
        console.error("No devices created in setup");
        return;
    }

    console.log("===== Device Send Summary (informational) =====");
    // Log per-device sent count (using total_sent_count metric)
    const totalSent = __ENV.WS_MSG_INTERVAL ? Number(__ENV.WS_MSG_INTERVAL) : 300;
    console.log(`Approx. messages sent per device will be visible in summary.json`);
}

export function handleSummary(data) {
    // Write metrics for YAML processing
    return { "summary.json": JSON.stringify(data) };
}
