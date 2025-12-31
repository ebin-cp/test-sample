import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Gauge } from "k6/metrics";

// ===== Metrics used by CI =====
const gauge_devices_found = new Gauge("devices_found_count");
const gauge_conn_success = new Gauge("connections_success_count");
const gauge_integrity_pass = new Gauge("integrity_passed_count");
const gauge_total_sent = new Gauge("total_sent_count");
const gauge_total_saved = new Gauge("total_saved_count");

export const options = {
    vus: 50,
    duration: "1m",
};

// ===== SETUP =====
export function setup() {
    const deviceKeys = [];
    const startNS = Date.now() * 1e6;

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

    return { keys: deviceKeys, startNS };
}

// ===== LOAD: WebSocket traffic =====
export default function (data) {
    if (!data.keys.length) return;

    const index = __VU - 1;
    const device = data.keys[index % data.keys.length];
    const interval = Number(__ENV.WS_MSG_INTERVAL) || 300;

    ws.connect(
        "ws://localhost:8883/api/live",
        {
            headers: {
                Authorization: `${device.imei} ${device.api_key}`,
            },
        },
        (socket) => {
            socket.on("open", () => {
                socket.setInterval(() => {
                    const ts = Date.now() * 1e6;
                    const payload = [
                        `volume,imei=${device.imei} vol=100 ${ts}`,
                    ].join("\n");

                    socket.send(payload);
                }, interval);

                // Close before test end
                socket.setTimeout(() => socket.close(), 55000);
            });
        }
    );
}

// ===== TEARDOWN: Verification =====
export function teardown(data) {
    if (!data.keys.length) return;

    sleep(20); // DB flush time

    const interval = Number(__ENV.WS_MSG_INTERVAL) || 300;
    const sendsPerDevice = Math.floor(60 / (interval / 1000));
    const expectedPerDevice = sendsPerDevice; // volume only

    const endNS = Date.now() * 1e6;

    let devicesRetrieved = 0;
    let successfulConnections = 0;
    let integrityPassed = 0;
    let totalSaved = 0;

    // ---- Device retrieval ----
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: {
            Authorization: `${data.keys[0].imei} ${data.keys[0].api_key}`,
        },
    });

    check(listRes, {
        "Device list status 200": (r) => r.status === 200,
        "Device list not empty": (r) => r.json().length > 0,
    });

    devicesRetrieved = listRes.json().length;

    // ---- Per-device data integrity ----
    data.keys.forEach((device) => {
        const measUrl =
            `http://localhost:8883/api/v1/device/measurements` +
            `?imei=${device.imei}` +
            `&measurement=volume` +
            `&start_ns=${data.startNS}` +
            `&end_ns=${endNS}`;

        const res = http.get(measUrl, {
            headers: {
                Authorization: `${device.imei} ${device.api_key}`,
            },
        });

        if (res.status === 200) {
            successfulConnections++;
            const actual = res.json().length;
            totalSaved += actual;

            if (actual === expectedPerDevice) {
                integrityPassed++;
            }
        }
    });

    // ---- Report metrics to CI ----
    gauge_devices_found.add(devicesRetrieved);
    gauge_conn_success.add(successfulConnections);
    gauge_integrity_pass.add(integrityPassed);
    gauge_total_sent.add(expectedPerDevice * data.keys.length);
    gauge_total_saved.add(totalSaved);

    console.log(`Expected per device: ${expectedPerDevice}`);
    console.log(`Integrity passed: ${integrityPassed}/${data.keys.length}`);
}

// ===== Summary =====
export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data, null, 2),
    };
}
