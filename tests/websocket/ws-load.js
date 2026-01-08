import ws from "k6/ws";
import { Counter } from "k6/metrics";

export const ws_metrics_sent_msgs = new Counter("ws_metrics_sent_msgs");

export function sendLoadMetrics(myKey, interval) {
    const url = "ws://localhost:8883/api/live";

    ws.connect(
        url,
        {
            headers: {
                Origin: "robad.in",
                Authorization: `${myKey.imei} ${myKey.api_key}`,
            },
        },
        (socket) => {
            socket.on("open", () => {
                socket.setInterval(() => {
                    const time_str = Date.now() * 1000000;
                    const cellular_log = `cellular,imei=${myKey.imei} rssi=16.56,iccid="89919509129637837632",operator="airtel",band="LTE BAND 40",rat="TDD LTE",plmn="40495",apn="iot.com" ${time_str}`;
                    const volume_log = `volume,imei=${myKey.imei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                    const fw_log = `firmware,imei=${myKey.imei} firmware_ver_tx="v1.0.0:slm-t",node_0x01_fw="v1.0.0:slm-s",node_0x02_fw="v1.0.0:slm-s" ${time_str}`;
                    const bat_log = `battery,imei=${myKey.imei} eBatVolt=12.00 ${time_str}`;
                    
                    socket.send([cellular_log, volume_log, fw_log, bat_log].join("\n"));
                    ws_metrics_sent_msgs.add(1);
                }, interval);
            });

            socket.on("message", (e) => console.log(`[VU ${__VU}] Message:`, e.toString()));
            socket.on("error", (e) => console.error(`[VU ${__VU}] WS Error:`, e.error()));
        }
    );
}