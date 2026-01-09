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

    const res = ws.connect(url, params, (socket) => {
        socket.on("open", () => {
            socket.send("SYNC:CALIBRATION:volume");
        });

        socket.on("message", (msg) => {
            const cleanMsg = msg.replace(/[^0-9]/g, '');
            const expectedMapping = expectedData.truck_tank_volume_mapping.replace(/[^0-9]/g, '');

            const isMatch = cleanMsg.includes(expectedMapping);

            if (isMatch) {
                calibrationSyncCounter.add(1);
                console.log(`[Calibration PASS] IMEI: ${imei}`);
            } else {
                console.log(`[Calibration FAIL] IMEI: ${imei} | Expected: ${expectedMapping} | Received: ${cleanMsg}`);
            }

            check(msg, {
                "Calibration verified": () => isMatch,
            });

            socket.close();
        });

        socket.on("error", (e) => {
            console.error(`[WS Error] ${imei}: ${e.error()}`);
        });

        socket.setTimeout(() => {
            socket.close();
        }, 10000);
    });

    check(res, { "WS Handshake successful": (r) => r && r.status === 101 });
}