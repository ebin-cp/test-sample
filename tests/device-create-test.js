import http from "k6/http";
import { check, fail, sleep } from "k6";

export const options = {
    vus: 1,
    iterations: 1,
};

const BASE_URL = "http://localhost:8883/api/v1/device";

/**
 * Generate deterministic IMEI (k6-safe, CI-safe)
 */
function generateImei(index) {
    return `TEST-IMEI-${Date.now()}-${index}`;
}

/**
 * Create device with retry (handles 502 during cold start)
 */
function createDeviceWithRetry(imei, retries = 5) {
    for (let i = 1; i <= retries; i++) {
        const res = http.post(
            BASE_URL,
            JSON.stringify({ imei }),
            {
                headers: { "Content-Type": "application/json" },
                timeout: "15s",
            }
        );

        if (res.status === 200) {
            return res.json();
        }

        console.warn(
            `⚠️ Device create failed (status ${res.status}), attempt ${i}/${retries}`
        );
        sleep(2);
    }

    fail(`❌ Device creation failed after ${retries} retries`);
}

/**
 * SETUP — Create 50 devices
 */
export function setup() {
    const devices = [];

    for (let i = 0; i < 50; i++) {
        const imei = generateImei(i);
        const body = createDeviceWithRetry(imei);

        if (!body.key || !body.key.key) {
            fail(`Invalid response: ${JSON.stringify(body)}`);
        }

        devices.push({
            imei,
            api_key: body.key.key,
        });

        sleep(0.2); // gentle pacing for backend stability
    }

    console.log(`✅ Created ${devices.length} devices`);
    return { devices };
}

/**
 * DEFAULT — REQUIRED by k6 (no-op)
 */
export default function () {
    // intentionally empty
}

/**
 * TEARDOWN — Retrieve and validate devices
 */
export function teardown(data) {
    const authKey = data.devices[0].api_key;

    const res = http.get(BASE_URL, {
        headers: { Authorization: authKey },
        timeout: "30s",
    });

    check(res, {
        "device list status is 200": (r) => r.status === 200,
        "50 devices retrieved": (r) => r.json().length === 50,
    });

    const retrievedImeis = res.json().map((d) => d.imei);
    const missing = data.devices.filter(
        (d) => !retrievedImeis.includes(d.imei),
    );

    if (missing.length > 0) {
        fail(`❌ Missing devices: ${missing.map((d) => d.imei).join(", ")}`);
    }

    console.log("✅ All 50 created devices were successfully retrieved");
}
