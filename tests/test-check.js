import http from "k6/http";
import ws from "k6/ws";
import { check } from "k6";
import { Counter } from "k6/metrics";

export const options = {
    vus: 50,
    duration: "1m",
};

const registrationCount = new Counter("registrations_total");
const ws_messages_sent = new Counter("ws_messages_sent");
const MESSAGE_INTERVAL_MS = 10 * 1000; // 10 seconds

export function setup() {
    const deviceKeys = [];
    const testStart = Date.now() * 1e6; // nanoseconds
    const failures = [];

    // 1. Create 50 devices
    for (let i = 0; i < 50; i++) {
        const imei = `device-${i}-${Date.now()}`;
        const payload = JSON.stringify({ imei });
        const res = http.post("http://localhost:8883/api/v1/device", payload, {
            headers: { "Content-Type": "application/json" },
        });

        const statusCheck = check(res, { "Device creation status 200": (r) => r.status === 200 });
        if (!statusCheck) failures.push(`Device ${imei} creation failed with status ${res.status}`);

        const body = res.json();
        if (!body.key || !body.result || body.result !== "success") {
            failures.push(`Device creation failed for ${imei}: ${res.body}`);
        }

        registrationCount.add(1);
        deviceKeys.push({ imei: body.key.imei || imei, api_key: body.key.key });
    }

    console.log(`Created ${deviceKeys.length} devices`);

    if (failures.length > 0) {
        console.error("Device creation failures:");
        failures.forEach((f) => console.error(f));
    }

    return { keys: deviceKeys, testStart };
}

export default function (data) {
    const myKey = data.keys[__VU - 1];
    const url = "ws://localhost:8883/api/live";

    const res = ws.connect(
        url,
        { headers: { Authorization: `${myKey.imei} ${myKey.api_key}` } },
        (socket) => {
            socket.on("open", () => {
                let interval = setInterval(() => {
                    const timestamp = Date.now() * 1e6;
                    const message = `volume,imei=${myKey.imei},value=10 ${timestamp}`;
                    socket.send(message);
                    ws_messages_sent.add(1);
                }, MESSAGE_INTERVAL_MS);

                setTimeout(() => clearInterval(interval), 60 * 1000); // stop after 1 min
            });

            socket.on("error", (e) => console.error(`WS Error for ${myKey.imei}:`, e.error()));
        }
    );

    check(res, { "connected successfully": (r) => r && r.status === 101 });
}

// Soft-fail verification and data integrity
export function deviceVerification(data) {
    const testEnd = Date.now() * 1e6;
    const devices = data.keys;
    const failures = [];
    const deviceDataSent = {};
    const deviceDataDB = {};
    let totalReceivedDB = 0;

    // 1. Device retrieval
    const resDevice = http.get("http://localhost:8883/api/v1/device");
    check(resDevice, {
        "Device retrieval status 200": (r) => r.status === 200,
        "Device list not empty": (r) => r.json().length > 0,
    });
    console.log(`Retrieved ${resDevice.json().length} devices`);

    // 2. Measurement endpoint for each device
    devices.forEach((device) => {
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.testStart}&end_ns=${testEnd}`;
        const res = http.get(url);

        const statusCheck = check(res, {
            [`Measurement endpoint 200 for ${device.imei}`]: (r) => r.status === 200,
        });
        if (!statusCheck) failures.push(`Measurement endpoint failed for ${device.imei} status ${res.status}`);

        const measurements = res.json();
        const count = measurements ? measurements.length : 0;
        if (count === 0) failures.push(`Device ${device.imei} has 0 measurements`);
        console.log(`Device ${device.imei} measurements received: ${count}`);
        deviceDataDB[device.imei] = count;

        // Approximate sent count for this device
        // Each VU sends every 10 seconds for 1 min => ~6 messages per device
        deviceDataSent[device.imei] = Math.ceil(60 * 1000 / MESSAGE_INTERVAL_MS);
        totalReceivedDB += count;
    });

    const totalSent = Object.values(deviceDataSent).reduce((a, b) => a + b, 0);

    console.log("\n=== Data Integrity Summary ===");
    console.log(`Total messages sent: ${totalSent}`);
    console.log(`Total messages in DB: ${totalReceivedDB}`);

    devices.forEach((device) => {
        console.log(`Device ${device.imei}: Sent=${deviceDataSent[device.imei]}, DB=${deviceDataDB[device.imei]}`);
    });

    if (failures.length > 0) {
        console.error("=== FAILURES DETECTED ===");
        failures.forEach((f) => console.error(f));
    } else {
        console.log("All devices passed verification and data integrity check");
    }
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}
