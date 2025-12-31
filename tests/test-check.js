import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
    vus: 50,           // 50 virtual users
    duration: '1m',    // 1 minute test duration
    thresholds: {
        checks: ['rate>0.95'], // at least 95% checks must pass
    },
};

export default function () {
    // Create device
    let deviceName = `device-${__VU}-${Date.now()}`;
    let createRes = http.post('http://localhost:8883/devices', JSON.stringify({ name: deviceName }), {
        headers: { 'Content-Type': 'application/json' },
    });

    // Validate device creation
    let success = check(createRes, {
        'device created': (r) => r.status === 200 && r.json().result === 'Success',
    });

    if (!success) {
        console.error(`Device creation failed: ${createRes.body}`);
        return;
    }

    // Get device key
    let deviceKey = createRes.json().key.key;

    // Send measurements for this device repeatedly
    for (let i = 0; i < 10; i++) {
        let measurementRes = http.post(`http://localhost:8883/devices/${deviceKey}/measurements`, JSON.stringify({
            temperature: Math.floor(Math.random() * 100),
            humidity: Math.floor(Math.random() * 100),
        }), {
            headers: { 'Content-Type': 'application/json' },
        });

        check(measurementRes, {
            'measurement accepted': (r) => r.status === 200,
        });

        sleep(1); // small delay between messages
    }
}
