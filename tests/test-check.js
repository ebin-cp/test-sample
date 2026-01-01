import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { sleep , check, fail } from "k6";
import { Counter } from "k6/metrics";

import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { ulid } from 'https://jslib.k6.io/ulid/1.2.0/index.js';
import { teardown } from "./api-verification-test";

const registrationCount = new Counter('registrations');
const ws_metrics_sent_msgs = new Counter('ws_msgs_sent');
const ws_msg_interval = Number(`${__ENV.WS_MSG_INTERVAL}`)

export const options = {
    vus: 10,
    duration: "1m",
};

export function setup() {
    const deviceKeys = [];
    const numDevices = options.vus;

    for (let i = 0; i < numDevices; i++) {
        const imei = ulid();
        const payload = JSON.stringify({ imei: imei });
        const params = { headers: { "Content-Type": "application/json" } };
        const res = http.post(
            "http://localhost:8883/api/v1/device", 
            payload,
            params
        );
        if (res.status !== 200) {
            fail(`Aborting: Received ${res.status}. Body: ${res.body}`);
        }
        let d;
        try {
            d = res.json();
        } catch (e) {
            fail(`Aborting: Response not valid JSON. Body: ${res.body}`);
        }
        if (d.result === "success" && d.key) {
            registrationCount.add(1);
            deviceKeys.push({ api_key: d.key.key, imei: imei });
        } else {
            fail(`Aborting: Unexpected JSON structure: ${JSON.stringify(d)}`);
        }
    }
    return { keys: deviceKeys };
}

export default function(data) {
    // Safety check: ensure we have a key for this VU
    if (!data.keys[__VU - 1]) return;

    const myKey = data.keys[__VU - 1];
    const url = "ws://localhost:8883/api/live";
    
    const res = ws.connect(
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
                    const volume_log = `volume,imei=${myKey.imei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                    
                    socket.send(volume_log); // Removed the array brackets [] if your server expects a raw string
                    ws_metrics_sent_msgs.add(1);
                }, ws_msg_interval);
            });

            socket.on("error", (e) => console.error("WS Error:", e.error()));
        }
    );

    check(res, { "connected successfully": (r) => r && r.status === 101 });
}
    
export function teardown(data) {
    sleep(120);
    //Device Retrieval Check
    const listRes = http.get("http://localhost:8883/api/v1/device",{
        headers: {"Authorization":`${data.keys[0].api_key}`},
        timeout:'120s'
    });
    if(listRes.status !== 200){
        console.log(`Aborting test: Unexpected JSON structure. Received: ${listRes.body}`)
    }
    if(listRes.status === 0 && listRes.body.length === 0){
        console.log("Stop: Get Device returned 200 but body was empty");
    }
    if(listRes.status === 200 && listRes.body.length !== 0){
        const listData = listRes.json();
        const retrievedCount = listData.length;
        console.log('Retrieved Device List Count',retrievedCount);
    }

    // Device Measurement endpoint check
    let successfulConns = 0;
    data.keys.forEach((device)=>{
        const url =`http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.startNS}&end_ns=${Date.now() * 1000000}`
        const res = http.get(url,{
            headers:{Authorization: `${device.api_key}`},
            timeout: '120s'
        });
        if(res.status !== 200){
            console.log(`Aborting test: Unexpected JSON structure received ${res.body}`)
        }
        if(res.status === 200 && res.body.length !== 0){
            console.log('Measurement Endpoint check res status length',res.body.length)
        }
        if (res.status === 200) {
            const rowCount = res.json().length;
            console.log(`DEVICE AUDIT [${device.imei}]: Total Rows Found = ${rowCount}`);
            successfulConns++;
            totalDbRows += (rowCount * 4); 
        } else {
            console.log(`DEVICE AUDIT [${device.imei}]: FAILED - Status ${res.status}`);
        }
        sleep(5); 
    });
}

export function handleSummary(data) {
    return { "summary.json": JSON.stringify(data) };
}
