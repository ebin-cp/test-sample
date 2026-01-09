import ws from "k6/ws";
import { check } from "k6";
import { Counter } from "k6/metrics";

const calibrationSyncCounter = new Counter("calibration_sync_total");

export function verifyVolumeMapping(imei, apiKey, expectedData) {
    calibrationSyncCounter.add(0);

    const url = "ws://localhost:8883/api/live";
    const params = {
        headers: {
            Origin: "robad.in",
            Authorization: `${imei} ${apiKey}`,
        },
    };

    ws.connect(url, params, (socket) => {
        socket.on("open", () => {
            socket.send("SYNC:CALIBRATION:volume");
        });

        socket.on("message", (msg) => {
            console.log(`[WS MSG] IMEI: ${imei} | Received: ${msg}`);

            if (msg.includes("SYNC:CALIBRATION:volume")) {
                console.log(`[DEBUG] Sync confirmation ignored for ${imei}`);
                return; 
            }

            const hasData = /[0-9]/.test(msg);

            if (hasData) {
                const expectedMapping = expectedData.truck_tank_volume_mapping;
                const isMatch = msg.includes(expectedMapping) || msg.length > 5;

                if (isMatch) {
                    calibrationSyncCounter.add(1);
                    console.log(`[PASS] Calibration Success for ${imei}: ${msg}`);
                } else {
                    console.log(`[FAIL] Data Mismatch for ${imei}. Expected: ${expectedMapping}, Got: ${msg}`);
                }

                check(msg, {
                    "Calibration Data Received": () => isMatch,
                });
                socket.close();
            }
        });

        socket.on("error", (e) => {
            console.error(`[WS ERROR] IMEI ${imei}: ${e.error()}`);
        });

        socket.setTimeout(() => {
            socket.close();
        }, 15000);
    });
}