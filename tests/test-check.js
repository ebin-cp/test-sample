import http from 'k6/http';
import ws from 'k6/ws';
import { sleep } from 'k6';

export const options = {
    vus: 50,
    duration: '70s',
};

const BASE_URL = 'http://localhost:8883/api/v1';
const WS_URL = 'ws://localhost:8883/api/live';

export function setup() {
    const imeis = Array.from({ length: 50 }, (_, i) => `DEV_${1000 + i}`);
    for (const imei of imeis) {
        http.post(`${BASE_URL}/device`, JSON.stringify({ imei: imei }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }
    return { imeis, startTimeNs: Date.now() * 1000000 };
}

export default function (data) {
    const myImei = data.imeis[__VU - 1]; 
    try {
        ws.connect(WS_URL, {}, function (socket) {
            socket.on('open', function () {
                for (let sec = 0; sec < 60; sec++) {
                    const time_str = new Date().toISOString();
                    const volume_log = `volume,imei=${myImei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                    socket.send(volume_log);
                    sleep(1);
                }
                socket.close();
            });
        });
    } catch (e) {
        console.log(`LOG_ERROR|${myImei}|${e}`);
    }
}

export function teardown(data) {
    const endTimeNs = Date.now() * 1000000;
    sleep(5); 

    const devRes = http.get(`${BASE_URL}/device`);
    let devBody = [];
    try { devBody = JSON.parse(devRes.body); } catch(e) {}
    
    // Explicit markers for YML parsing
    console.log(`DEV_CHECK_MARKER|${devRes.status}|${devBody.length === 0}|${devBody.length}`);

    for (const imei of data.imeis) {
        const mRes = http.get(`${BASE_URL}/device/measurements?imei=${imei}&measurement=volume&start_ns=${data.startTimeNs}&end_ns=${endTimeNs}`);
        let mData = [];
        try { mData = JSON.parse(mRes.body); } catch(e) {}
        console.log(`MEASURE_CHECK_MARKER|${imei}|${mRes.status}|${mData.length}`);
    }
}