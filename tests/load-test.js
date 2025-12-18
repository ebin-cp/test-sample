import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

const registrationCount = new Counter("registrations_total");
const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const ws_msg_interval = Number(`${__ENV.WS_MSG_INTERVAL}`);

export const options = {
    vus: 50, // 50 simultaneous clients
    duration: "10m", // run the test for 10 minute
    registrations_total: ["count >= 50"],
    ws_metrics_sent_msgs: ["count >= 10000"],
};

// 1. SETUP: Runs once before the test starts
export function setup() {
    const deviceKeys = [];

    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };

        const res = http.post(
            "http://localhost:8883/api/v1/device",
            payload,
            params,
        );
        if (res.status !== 200) {
            fail(`Aborting test: Unexpected JSON structure. Received: ${res.body}`);
        }
        if (!res.body || res.body.length === 0) {
            fail("STOP: Server returned 200 but the body was empty!");
        }
        let d;
        try {
            d = res.json();
        } catch (e) {
            fail(`Aborting: Response was not valid JSON. Body: ${res.body}`);
        }
        if (d.result !== "success" && !d.key) {
            fail(`Aborting test: Unexpected JSON structure. Received: ${res.body}`);
        }
        registrationCount.add(1);
        deviceKeys.push({ api_key: d.key.key, imei: imei });
    }
    // Return the keys so they are available in the default function
    return { keys: deviceKeys };
}

// 2. VU EXECUTION: Runs for each of the 50 clients
export default function(data) {
    // Each VU picks its unique key based on its ID (1 to 50)
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
                // Send message every 300ms
                socket.setInterval(() => {
                    const time_str = Date.now() * 1000000;
                    const cellular_log = `cellular,imei=${myKey.imei} rssi=16.56,iccid=\"89919509129637837632\",operator=\"airtel\",band=\"LTE BAND 40\",rat=\"TDD LTE\",plmn=\"40495\",apn=\"iot.com\" ${time_str}`;
                    const volume_log = `volume,imei=${myKey.imei} nodeAddress=\"0x01,0x02,0x03\",mask=\"0x20\",sensorValue=6,volume=100.0 ${time_str}`;
                    const fw_log = `firmware,imei=${myKey.imei} firmware_ver_tx=\"v1.0.0:slm-t\",node_0x01_fw=\"v1.0.0:slm-s\",node_0x02_fw=\"v1.0.0:slm-s\" ${time_str}`;
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

export function handleSummary(data) {
    return {
        "summary.json": JSON.stringify(data), // This creates the file in the workspace
    };
}
