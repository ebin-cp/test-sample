import ws from "k6/ws";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");
const calibration_sync_total = new Counter("calibration_sync_total");

export function sendWsMetrics(imei, apiKey) {
    const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 1000;
    const ws_duration = Number(__ENV.WS_DURATION) || 60000; 

    ws.connect(__ENV.WS_URL || "ws://localhost:8883/api/live", {
        headers: { Origin: "robad.in", Authorization: `${imei} ${apiKey}` },
    }, (socket) => {
        
        socket.on("open", () => {
            socket.send("SYNC:CALIBRATION:volume");
            console.log(`[VU ${__VU}] - Sent: SYNC:CALIBRATION:volume`);

            const startTime = Date.now();

            const timer = socket.setInterval(() => {
                const time_str = (Date.now() * 1000000).toString();
                
                const cellular_log = `cellular,imei=${imei} rssi=16.56,iccid="89919509129637837632",operator="airtel",band="LTE BAND 40",rat="TDD LTE",plmn="40495",apn="iot.com" ${time_str}`;
                const volume_log = `volume,imei=${imei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                const fw_log = `firmware,imei=${imei} firmware_ver_tx="v1.0.0:slm-t",node_0x01_fw="v1.0.0:slm-s",node_0x02_fw="v1.0.0:slm-s" ${time_str}`;
                const bat_log = `battery,imei=${imei} eBatVolt=12.00 ${time_str}`;
                
                socket.send([cellular_log, volume_log, fw_log, bat_log].join("\n"));
                ws_metrics_sent_msgs.add(1);
                
                if (Date.now() - startTime >= ws_duration) {
                    clearInterval(timer);
                    socket.close();
                    console.log(`[VU ${__VU}] - WS Period finished.`);
                }
            }, ws_msg_interval);
        });

        socket.on("message", (msg) => {
            const data = msg.toString();
            console.log(`[VU ${__VU}] Received from Server: ${data}`);
            if (data.trim().length > 0) {
                console.log(`[VU ${__VU}] Calibration Verified`);
                calibration_sync_total.add(1); 
            }
        });

        socket.on("error", (e) => console.error(`[VU ${__VU}] WS Error:`, e.error()));
    });
}