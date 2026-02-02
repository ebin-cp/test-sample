import ws from "k6/ws";
import { Counter } from "k6/metrics";

const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");

export function sendWsMetrics(imei, apiKey, interval = 300, duration = 600000) {
    ws.connect("ws://localhost:8883/api/live", {
        headers: { Origin: "robad.in", Authorization: `${imei} ${apiKey}` },
    }, (socket) => {
        socket.on("open", () => {
            const startTime = Date.now();
            const timer = socket.setInterval(() => {
                const time_str = (Date.now() * 1000000).toString();
                
                const logs = [
                    `cellular,imei=${imei} rssi=16.56,iccid="89919509129637837632",operator="airtel",band="LTE BAND 40",rat="TDD LTE",plmn="40495",apn="iot.com" ${time_str}`,
                    `volume,imei=${imei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`,
                    `firmware,imei=${imei} firmware_ver_tx="v1.0.0:slm-t",node_0x01_fw="v1.0.0:slm-s",node_0x02_fw="v1.0.0:slm-s" ${time_str}`,
                    `battery,imei=${imei} eBatVolt=12.00 ${time_str}`
                ].join("\n");

                socket.send(logs);
                ws_metrics_sent_msgs.add(1);
                
                if (Date.now() - startTime >= duration) {
                    clearInterval(timer);
                    socket.close();
                }
            }, interval);
        });
    });
}

export default function(data) {
    if (data && data.keys && data.keys.length > 0) {
        const myKey = data.keys[0]; 
        sendWsMetrics(myKey.imei, myKey.api_key);
    }
}