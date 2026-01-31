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
        let isMatched = false;

        socket.on("open", () => {
            const retryInterval = socket.setInterval(() => {
                if (!isMatched) {
                    socket.send("SYNC:CALIBRATION:volume");
                } else {
                    socket.clearInterval(retryInterval);
                }
            }, 2500);

            socket.send("SYNC:CALIBRATION:volume");
        });

        socket.on("message", (msg) => {
            if (msg.includes("SYNC:CALIBRATION:volume")) return;
            const hasData = /[0-9]/.test(msg);

            if (hasData && !isMatched) {
                isMatched = true; 
                calibrationSyncCounter.add(1);

                check(msg, {
                    "Calibration Values Received": (m) => m.length > 2,
                });

                console.log(`[SUCCESS] IMEI: ${imei} | Data: ${msg}`);
                socket.close(); 
            }
        });

        socket.on("error", (e) => {
            console.error(`[WS ERROR] IMEI ${imei}: ${e.error()}`);
        });
        socket.setTimeout(() => {
            socket.close();
        }, 25000);
    });
}