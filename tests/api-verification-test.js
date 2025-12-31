import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Gauge } from "k6/metrics";

// Metrics (used by GitHub Actions)
const gauge_devices_found = new Gauge("devices_found_count");
const gauge_conn_success = new Gauge("connections_success_count");
const gauge_integrity_pass = new Gauge("integrity_passed_count");
const gauge_total_sent = new Gauge("total_sent_count");
const gauge_total_saved = new Gauge("total_saved_count");

export const options = {
    vus: 50,
    duration: "1m",
};

export function setup() {
    const deviceKeys = [];

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post(
            "http://localhost:8883/api/v1/device",
            JSON.stringify({ imei }),
            { headers: { "Content-Type": "application/json" } }
        );

        if (res.status === 200) {
            deviceKeys.push({
                imei,
                api_key: res.json().key.key,
            });
        }
    }

    return { keys: deviceKeys };
}

export default function (data) {
    if (!data.keys.length) return;

    const index = __VU - 1;
    const device = data.keys[index % data.keys.length];
    const url = "ws://localhost:8883/api/live";

    ws.connect(
        url,
        { headers: { Authorization: `${device.imei} ${device.api_key}` } },
        (socket) => {
            socket.on("open", () => {
                socket.setInterval(() => {
                    const ts = Date.now() * 1e6;
                    const payload = [
                        `cellular,imei=${device.imei} rssi=10 ${ts}`,
                        `battery,imei=${device.imei} v=12 ${ts}`,
                        `firmware,imei=${device.imei} ver=1.0 ${ts}`,
                        `volume,imei=${device.imei} vol=100 ${ts}`,
                    ].join("\n");

                    socket.send(payload);
                }, Number(__ENV.WS_MSG_INTERVAL) || 300);
            });
        }
    );
}

export function teardown(data) {
    sleep(10); // DB settle time

    const interval = Number(__ENV.WS_MSG_INTERVAL) || 300;
    const expectedPerDevice = Math.floor(60 / (interval / 1000)) * 4;

    let devicesRetrieved = 0;
    let successfulConnections = 0;
    let integrityPassed = 0;
    let totalSaved = 0;

    // 1️⃣ Device Retrieval
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { Authorization: data.keys[0].api_key },
    });

    check(listRes, {
        "Device list status is 200": (r) => r.status === 200,
        "Device list not empty": (r) => r.json().length > 0,
    });

    devicesRetrieved = listRes.json().length;

    // 2️⃣ Per-device audit
    data.keys.forEach((device) => {
        const res = http.get(
            `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}`,
            { headers: { Authorization: device.api_key } }
        );

        if (res.status === 200) {
            successfulConnections++;
            const actual = res.json().length;
            totalSaved += actual;

            if (actual === expectedPerDevice) {
                integrityPassed++;
            }
        }
    });

    // 3️⃣ Metrics for CI
    gauge_devices_found.add(devicesRetrieved);
    gauge_conn_success.add(successfulConnections);
    gauge_integrity_pass.add(integrityPassed);
    gauge_total_sent.add(expectedPerDevice * data.keys.length);
    gauge_total_saved.add(totalSaved);

    console.log(`Expected per device: ${expectedPerDevice}`);
    console.log(`Integrity passed: ${integrityPassed}/50`);
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}