import ws from "k6/ws";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");

export function sendWsMetrics(imei, apiKey) {
    const ws_msg_interval = Number(__ENV.WS_MSG_INTERVAL) || 1000;
    
    ws.connect("ws://localhost:8883/api/live", {
        headers: { Origin: "robad.in", Authorization: `${imei} ${apiKey}` },
    }, (socket) => {
        socket.on("open",()=>{
            socket.setInterval(()=>{
                const time_str = (Date.now() * 1000000).toString();
                const cellular_log = `cellular,imei=${myKey.imei} rssi=16.56,iccid=\"89919509129637837632\",operator=\"airtel\",band=\"LTE BAND 40\",rat=\"TDD LTE\",plmn=\"40495\",apn=\"iot.com\" ${time_str}`;
                const volume_log = `volume,imei=${myKey.imei} nodeAddress=\"0x01,0x02,0x03\",mask=\"0x20\",sensorValue=6,volume=100.0 ${time_str}`;
                const fw_log = `firmware,imei=${myKey.imei} firmware_ver_tx=\"v1.0.0:slm-t\",node_0x01_fw=\"v1.0.0:slm-s\",node_0x02_fw=\"v1.0.0:slm-s\" ${time_str}`;
                const bat_log = `battery,imei=${myKey.imei} eBatVolt=12.00 ${time_str}`;
                socket.send([cellular_log, volume_log, fw_log, bat_log].join("\n"));
                ws_metrics_sent_msgs.add(1);
                }, ws_msg_interval);
            });
            socket.on("message", (e) => console.log(e.toString()));
            socket.on("error", (e) => console.error("WS Error:", e.error()));
        });
    }