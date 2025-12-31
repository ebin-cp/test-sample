import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

// Custom counters
const registrationCount = new Counter("registrations_total");
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");

// Parse WS interval from environment
const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL || 10000);

export const options = {
    vus: 50, // 50 simultaneous clients
    duration: "2m", // 2 minutes
    thresholds: {
        registrations_total: ["count>=50"],
        ws_metrics_sent_msgs: ["count>=10000"],
    },
};

// Setup: register 50 devices
export function setup() {
    const deviceKeys = [];
    const startNS = Date.now() * 1_000_000; // nanoseconds

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };

        let res;
        try {
            res = http.post("http://localhost:8883/api/v1/device", payload, params);
        } catch (e) {
            fail(`HTTP request failed: ${e}`);
        }

        if (res.status !== 200) {
            fail(`Device registration failed: HTTP ${res.status}, Body: ${res.body}`);
        }

        let data;
        try {
            data = res.json();
        } catch (e) {
            fail(`Response was not valid JSON. Body: ${res.body}`);
        }

        if (data.result !== "success" || !data.key) {
            fail(`Unexpected JSON structure: ${res.body}`);
        }

        registrationCount.add(1);
        deviceKeys.push({ api_key: data.key.key, imei: imei });
    }

    return { keys: deviceKeys, startNS: startNS };
}

// Default function: WebSocket messaging
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
                    const time_str = Date.now() * 1_000_000;
                    const cellular_log = `cellular,imei=${myKey.imei} rssi=16.56,iccid="89919509129637837632",operator="airtel",band="LTE BAND 40",rat="TDD LTE",plmn="40495",apn="iot.com" ${time_str}`;
                    const volume_log = `volume,imei=${myKey.imei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                    const fw_log = `firmware,imei=${myKey.imei} firmware_ver_tx="v1.0.0:slm-t",node_0x01_fw="v1.0.0:slm-s",node_0x02_fw="v1.0.0:slm-s" ${time_str}`;
                    const bat_log = `battery,imei=${myKey.imei} eBatVolt=12.00 ${time_str}`;
                    socket.send([cellular_log, volume_log, fw_log, bat_log].join("\n"));
                    ws_metrics_sent_msgs.add(1);
                }, ws_msg_interval);
            });

            socket.on("error", (e) => console.error("WS Error:", e.error()));
        },
    );

    check(res, { "connected successfully": (r) => r && r.status === 101 });
}

// Teardown: validate device data
export function teardown(data) {
    console.log("--- Starting Final Test ---");

    let totalDbRows = 0;

    // Device retrieval audit
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { Authorization: `${data.keys[0].api_key}` },
        timeout: "60s",
    });

    if (listRes.status !== 200) {
        console.error(`Device retrieval failed: HTTP ${listRes.status}`);
    } else {
        console.log(`Retrieved ${listRes.json().length} devices`);
    }

    // Measurement endpoint audit
    data.keys.forEach((device) => {
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.startNS}&end_ns=${Date.now() * 1_000_000}`;
        const res = http.get(url, {
            headers: { Authorization: `${device.api_key}` },
            timeout: "60s",
        });

        if (res.status === 200) {
            const rowCount = res.json().length;
            console.log(`DEVICE AUDIT [${device.imei}]: Total Rows Found = ${rowCount}`);
            totalDbRows += rowCount * 4;
        } else {
            console.log(`DEVICE AUDIT [${device.imei}]: FAILED - Status ${res.status}`);
        }
        sleep(0.5);
    });

    console.log(`Total expected DB rows: ${totalDbRows}`);
}

// Generate summary.json for CI/CD
export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data),
    };
}
