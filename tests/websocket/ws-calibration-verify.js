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
            console.log(`[WS MSG] IMEI ${imei}: ${msg}`);

            if (msg.includes("SYNC:CALIBRATION:volume")) {
                console.log(`[DEBUG] Received Sync Confirmation for ${imei}, waiting for data...`);
                return; 
            }

            const cleanMsg = msg.replace(/[^0-9]/g, '');
            const expectedMapping = expectedData.truck_tank_volume_mapping.replace(/[^0-9]/g, '');
            const expectedVol = expectedData.truck_tank_volume.toString();

            const isMatch = cleanMsg.includes(expectedMapping) || msg.includes(expectedVol);

            if (isMatch) {
                calibrationSyncCounter.add(1);
                console.log(`[PASS] Calibration Data Matched for ${imei}`);
            } else {
                console.log(`[FAIL] Data Mismatch for ${imei}. Received: ${msg}`);
            }

            check(msg, {
                "Calibration Data Received": () => isMatch,
            });

            socket.close();
        });

        socket.on("error", (e) => {
            console.error(`[WS Error] ${imei}: ${e.error()}`);
        });

        socket.setTimeout(() => {
            socket.close();
        }, 15000);
    });
}