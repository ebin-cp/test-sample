import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const registrationCount = new Counter("registrations_total");
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");

// New counters for API checks
export const device_list_checks = new Counter("device_list_checks");
export const device_logs_checks = new Counter("device_logs_checks");

const ws_msg_interval = Number(`${__ENV.WS_MSG_INTERVAL}`);

export const options = {
    vus: 50,
    duration: "1m",
    thresholds: {
        registrations_total: ["count >= 50"],
        ws_metrics_sent_msgs: ["count > 0"], // sanity check
    },
     setupTimeout: "180s"
};

/* ---------------- SETUP ---------------- */
export function setup() {
    const deviceKeys = [];

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const payload = JSON.stringify({ imei });
        const params = { headers: { "Content-Type": "application/json" } };

        let res;
        // Retry for CI robustness
        for (let attempt = 0; attempt < 5; attempt++) {
            res = http.post("http://localhost:8883/api/v1/device", payload, params);
            if (res.status === 200) break;
            sleep(2);
        }

        if (res.status !== 200) {
            fail(`Device create failed: ${res.body}`);
        }

        const body = res.json();
        if (body.result !== "success" || !body.key?.key) {
            fail(`Invalid device create response: ${res.body}`);
        }

        registrationCount.add(1);
        deviceKeys.push({ imei, api_key: body.key.key });
    }

    return { keys: deviceKeys };
}

/* ---------------- LOAD ---------------- */
export default function (data) {
    const myKey = data.keys[__VU - 1];
    const url = "ws://localhost:8883/api/live";

    const res = ws.connect(
        url,
        {
            headers: {
                Origin: "robad.in",
                Authorization: `${myKey.imei} ${myKey.api_key}`,
            },
        },
        (socket) => {
            socket.on("open", () => {
                socket.setInterval(() => {
                    const ts = Date.now() * 1e6;

                    const logs = [
                        `cellular,imei=${myKey.imei} rssi=16.56 ${ts}`,
                        `volume,imei=${myKey.imei} volume=100 ${ts}`,
                        `firmware,imei=${myKey.imei} ver="v1.0.0" ${ts}`,
                        `battery,imei=${myKey.imei} volt=12.0 ${ts}`,
                    ];

                    socket.send(logs.join("\n"));
                    ws_metrics_sent_msgs.add(1);
                }, ws_msg_interval);
            });
        }
    );

    check(res, { "ws connected": (r) => r && r.status === 101 });
}

/* ---------------- API VERIFICATION ---------------- */
function checkDeviceList(expectedCount) {
    const res = http.get("http://localhost:8883/api/v1/devices");

    check(res, { "device list status 200": (r) => r.status === 200 }) ||
        fail("Device list API failed");

    const body = res.json();
    check(body, {
        "devices array exists": (b) => Array.isArray(b.devices),
        "device count correct": (b) => b.devices.length === expectedCount,
    }) || fail(`Expected ${expectedCount} devices`);

    device_list_checks.add(1);
}

function checkDeviceLogs(device) {
    const res = http.get(
        `http://localhost:8883/api/v1/device/${device.imei}/logs`,
        { headers: { Authorization: `${device.imei} ${device.api_key}` } }
    );

    check(res, { "log api status 200": (r) => r.status === 200 }) ||
        fail(`Log API failed for ${device.imei}`);

    const body = res.json();
    check(body, {
        "logs exist": (b) => Array.isArray(b.logs),
        "logs not empty": (b) => b.logs.length > 0,
        "imei match": (b) => b.logs.every((l) => l.imei === device.imei),
    }) || fail(`Invalid logs for ${device.imei}`);

    device_logs_checks.add(1);
}

/* ---------------- TEARDOWN ---------------- */
export function teardown(data) {
    // Device list verification
    checkDeviceList(data.keys.length);

    // Verify logs for first 3 devices
    for (let i = 0; i < 3; i++) {
        checkDeviceLogs(data.keys[i]);
    }
}

/* ---------------- SUMMARY ---------------- */
export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}
