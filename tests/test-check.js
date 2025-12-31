import http from 'k6/http';
import ws from 'k6/ws';
import { sleep } from 'k6';

export const options = {
    // 50 VUs running at once to simulate 50 concurrent devices
    vus: 50,
    duration: '70s', 
};

const BASE_URL = 'http://localhost:8883/api/v1';
const WS_URL = 'ws://localhost:8883/api/live';

// Global setup: Create devices once before VUs start sending data
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
    // Each VU gets its own unique IMEI from the list based on its ID
    const myImei = data.imeis[__VU - 1]; 
    
    ws.connect(WS_URL, {}, function (socket) {
        socket.on('open', function () {
            // Each device sends data for 60 seconds independently
            for (let sec = 0; sec < 60; sec++) {
                const time_str = new Date().toISOString();
                const volume_log = `volume,imei=${myImei} nodeAddress="0x01,0x02,0x03",mask="0x20",sensorValue=6,volume=100.0 ${time_str}`;
                
                socket.send(volume_log);
                sleep(1); // 1 second interval per device
            }
            socket.close();
        });
    });
}

// Global teardown: Runs once after all VUs finish to validate data
export function teardown(data) {
    const endTimeNs = Date.now() * 1000000;
    sleep(5); // Wait for last batch of data to settle in DB

    // 1. Check Devices List
    const devRes = http.get(`${BASE_URL}/device`);
    const devBody = JSON.parse(devRes.body || "[]");
    console.log(`DEVICE_CHECK|Status:${devRes.status}|Empty:${devBody.length === 0}|Count:${devBody.length}`);

    // 2. Check Individual Measurements for all 50
    data.imeis.forEach(imei => {
        const mRes = http.get(`${BASE_URL}/device/measurements?imei=${imei}&measurement=volume&start_ns=${data.startTimeNs}&end_ns=${endTimeNs}`);
        const mData = JSON.parse(mRes.body || "[]");
        console.log(`MEASURE_CHECK|${imei}|${mRes.status}|${mData.length}`);
    });
}