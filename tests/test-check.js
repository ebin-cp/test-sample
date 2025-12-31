import http from 'k6/http';
import ws from 'k6/ws';
import { sleep } from 'k6';

export const options = {
    vus: 50,
    duration: '70s',
    // Prevent k6 from crashing if a connection is refused
    throw: false, 
};

const BASE_URL = 'http://localhost:8883/api/v1';
const WS_URL = 'ws://localhost:8883/api/live';

export function setup() {
    const imeis = Array.from({ length: 50 }, (_, i) => `DEV_${1000 + i}`);
    imeis.forEach(imei => {
        http.post(`${BASE_URL}/device`, JSON.stringify({ imei: imei }), {
            headers: { 'Content-Type': 'application/json' },
        });
    });
    return { imeis, startTimeNs: Date.now() * 1000000 };
}

export default function (data) {
    const myImei = data.imeis[__VU - 1]; 
    
    const res = ws.connect(WS_URL, {}, function (socket) {
        socket.on('open', function () {
            for (let sec = 0; sec < 60; sec++) {
                const time_str = new Date().toISOString();
                const volume_log = `volume,imei=${myImei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                socket.send(volume_log);
                sleep(1);
            }
            socket.close();
        });

        socket.on('error', function (e) {
            console.log(`WS_ERROR|${myImei}|${e.error()}`);
        });
    });
}

export function teardown(data) {
    const endTimeNs = Date.now() * 1000000;
    sleep(5); 

    const devRes = http.get(`${BASE_URL}/device`);
    const devBody = JSON.parse(devRes.body || "[]");
    console.log(`DEVICE_CHECK|Status:${devRes.status}|Empty:${devBody.length === 0}|Count:${devBody.length}`);

    data.imeis.forEach(imei => {
        const mRes = http.get(`${BASE_URL}/device/measurements?imei=${imei}&measurement=volume&start_ns=${data.startTimeNs}&end_ns=${endTimeNs}`);
        const mData = JSON.parse(mRes.body || "[]");
        console.log(`MEASURE_CHECK|${imei}|${mRes.status}|${mData.length}`);
    });
}