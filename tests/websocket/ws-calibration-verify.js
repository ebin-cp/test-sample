import ws from "k6/ws";
import { check } from "k6";
import { Counter } from "k6/metrics";

const calibrationSyncCounter = new Counter("calibration_sync_total");

export function verifyVolumeMapping(imei, apiKey, expectedData) {
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
            const expectedMapping = expectedData.truck_tank_volume_mapping;
            const expectedVolume = expectedData.truck_tank_volume.toString();

            const mappingMatch = msg.includes(expectedMapping);
            const volumeMatch = msg.includes(expectedVolume);

            if (mappingMatch && volumeMatch) {
                calibrationSyncCounter.add(1);
            }

            check(msg, {
                "WS Mapping Match": () => mappingMatch,
                "WS Volume Match": () => volumeMatch,
            });

            socket.close();
        });

        socket.on("error", (e) => {
            console.error(`[WS Error] ${imei}: ${e.error()}`);
        });

        socket.setTimeout(() => {
            socket.close();
        }, 5000);
    });

    check(res, { "WS Handshake successful": (r) => r && r.status === 101 });
}