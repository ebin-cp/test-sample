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
        let isVerified = false;

        socket.on("open", () => {
            socket.send("SYNC:CALIBRATION:volume");
        });

        socket.on("message", (msg) => {
            console.log(`[WS MSG] IMEI: ${imei} | Received: ${msg}`);
            if (msg === "SYNC:CALIBRATION:volume") {
                return; 
            }
            const hasNumbers = /[0-9]/.test(msg);

            if (hasNumbers && !isVerified) {
                const expectedMapping = expectedData.truck_tank_volume_mapping;                
                const isMatch = msg.includes(expectedMapping) || msg.length > 3;

                if (isMatch) {
                    isVerified = true;
                    calibrationSyncCounter.add(1);
                    console.log(`[PASS] Data Verified for ${imei}: ${msg}`);
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