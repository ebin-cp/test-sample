import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import { check, fail } from "k6";

export const options = {
    vus: 1,
    iterations: 1,
};

const BASE_URL = "http://localhost:8883/api/v1/device";

/**
 * 1️⃣ SETUP — Create 50 devices
 */
export function setup() {
    const devices = [];

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const payload = JSON.stringify({ imei });
        const params = { headers: { "Content-Type": "application/json" } };

        const res = http.post(BASE_URL, payload, params);

        if (res.status !== 200) {
            fail(`Device creation failed: ${res.body}`);
        }

        const body = res.json();
        if (!body.key || !body.key.key) {
            fail(`Invalid response: ${res.body}`);
        }

        devices.push({
            imei,
            api_key: body.key.key,
        });
    }

    console.log(`✅ Created ${devices.length} devices`);
    return { devices };
}

/**
 * 2️⃣ DEFAULT — nothing needed here
 */
export default function () {
    // No VU execution needed
}

/**
 * 3️⃣ TEARDOWN — Retrieve devices and validate
 */
export function teardown(data) {
    const authKey = data.devices[0].api_key;

    const res = http.get(BASE_URL, {
        headers: {
            Authorization: authKey,
        },
        timeout: "60s",
    });

    check(res, {
        "device retrieval status is 200": (r) => r.status === 200,
    });

    const retrievedDevices = res.json();

    check(retrievedDevices, {
        "50 devices retrieved": (d) => d.length === 50,
    });

    // Validate all created IMEIs exist
    const retrievedImeis = retrievedDevices.map((d) => d.imei);
    const missing = data.devices.filter(
        (d) => !retrievedImeis.includes(d.imei),
    );

    if (missing.length > 0) {
        fail(`❌ Missing devices: ${missing.map((d) => d.imei).join(", ")}`);
    }

    console.log("✅ All 50 created devices were successfully retrieved");
}
