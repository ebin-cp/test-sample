import ws from "k6/ws";
import { check } from "k6";
import { Counter } from "k6/metrics";

const calibrationSyncCounter = new Counter("calibration_sync_total");
const getFirmwareCounter = new Counter("firmware_url_total");

export function verifyVolumeMapping(imei, apiKey) {
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
            if (!msg.includes("SYNC:CALIBRATION:volume") || !msg.length) return;
            const index = msg.indexOf("\n");
            const mapping_only_msg = index === -1 ? "" : msg.substring(index + 1);
            if (!mapping_only_msg.length) return;
            const hasData = /^(\d+,\d+(\.\d+)?(\r?\n|$)){3,100}$/.test(
                mapping_only_msg,
            );

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

export function verifyFirmwareUrl(imei, apiKey, expectedData) {
    getFirmwareCounter.add(0);

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
                    socket.send("GET:FIRMWARE:latest");
                } else {
                    socket.clearInterval(retryInterval);
                }
            }, 2500);

            socket.send("GET:FIRMWARE:latest");
        });

        socket.on("message", (msg) => {
            if (!msg.includes("GET:FIRMWARE:latest") || !msg.length) return;
            const index = msg.indexOf("\n");
            const mapping_only_msg = index === -1 ? "" : msg.substring(index + 1);
            const hasData = mapping_only_msg.length > 0;
            const isMatched = mapping_only_msg.startsWith("https://") || mapping_only_msg === expectedData;

            if (hasData && isMatched) {
                getFirmwareCounter.add(1);

                check(msg, {
                    "Firmware URL Received": (m) => m.length > 2,
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
