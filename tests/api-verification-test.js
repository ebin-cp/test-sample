import http from "k6/http";
import * as ulid from "https://esm.run/ulid";
import ws from "k6/ws";
import { sleep } from "k6";
import { Gauge } from "k6/metrics";

const gauge_devices_found = new Gauge('devices_found_count');
const gauge_conn_success = new Gauge('connections_success_count');
const gauge_integrity_pass = new Gauge('integrity_passed_count');
const gauge_total_saved = new Gauge('total_saved_count');

export const options = {
    vus: 50,
    duration: "1m"
};

export function setup() {
    const startTimeNS = Date.now() * 1000000;
    const deviceKeys = [];
    for (let i = 0; i < 50; i++) {
        const imei = ulid.ulid();
        const res = http.post("http://localhost:8883/api/v1/device", 
            JSON.stringify({ imei }), 
            { headers: { "Content-Type": "application/json" } }
        );
        if (res.status === 200) {
            deviceKeys.push({ api_key: res.json().key.key, imei: imei });
        }
    }
    return { keys: deviceKeys, startNS: startTimeNS };
}

export default function(data) {
    const myKey = data.keys[__VU - 1];
    ws.connect("ws://localhost:8883/api/live", {
        headers: { Authorization: `${myKey.imei} ${myKey.api_key}` },
    }, (socket) => {
        socket.on("open", () => {
            socket.setInterval(() => {
                const ts = Date.now() * 1000000;
                const payload = [
                    `cellular,imei=${myKey.imei} rssi=16 ${ts}`,
                    `volume,imei=${myKey.imei} vol=100 ${ts}`,
                    `firmware,imei=${myKey.imei} ver=1.0 ${ts}`,
                    `battery,imei=${myKey.imei} v=12 ${ts}`
                ].join("\n");
                socket.send(payload);
            }, Number(__ENV.WS_MSG_INTERVAL) || 300);
        });
    });
}

export function teardown(data) {
    console.log("--- Starting Final Test ---");
    
    // --- 1. Device Retrieval Audit ---
    const listRes = http.get("http://localhost:8883/api/v1/device", {
        headers: { "Authorization": `${data.keys[0].api_key}` },
        timeout:'60s'
    });

    const is200 = listRes.status === 200;
    const listData = is200 ? listRes.json() : [];
    const isNotEmpty = listData.length > 0;
    const retrievedCount = listData.length;

    // --- 2. Measurement Endpoint Audit ---
    let successfulConns = 0;
    data.keys.forEach((device) => {
        const url = `http://localhost:8883/api/v1/device/measurements?imei=${device.imei}&measurement=volume&start_ns=${data.startNS}&end_ns=${Date.now() * 1000000}`;
        
        const res = http.get(url, {
            headers: { Authorization: `${device.api_key}` },
            timeout: '60s' // <--- 1. Tell k6 to wait up to 60 seconds for a response
        });

        if (res.status === 200) {
            successfulConns++;
        } else {
            // This will show you in the logs why a specific device failed
            console.log(`Audit failed for ${device.imei}: Status ${res.status}`);
        }

        // 2. Add a tiny pause so we don't overwhelm the server during the audit
        sleep(0.1); 
    });

    // Send these values to the summary
    gauge_devices_found.add(retrievedCount); // Actual number found
    gauge_conn_success.add(successfulConns); // Number of 200 OK connections
    
    // We use a dummy gauge to pass the status of 'is200' and 'isNotEmpty'
    // 1 = Success, 0 = Failed
    const retrievalStatus = (is200 && isNotEmpty) ? 1 : 0;
    // You can also console log here for the k6 logs
    console.log(`Retrieval Status: ${is200 ? "200 OK" : "FAILED"}`);
    console.log(`Devices Found: ${retrievedCount}`);
}

export function handleSummary(data) {
    // 1. Calculate stats for the report
    const retrieved = data.metrics.devices_found_count.values.value || 0;
    const connections = data.metrics.connections_success_count.values.value || 0;
    const wsSent = data.metrics.total_sent_msgs.values.count || 0;
    const dbTotal = data.metrics.total_saved_count.values.value || 0;

    // 2. Build the HTML String
    let html = `
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
            h1 { color: #0056b3; border-bottom: 2px solid #0056b3; }
            .summary-box { display: flex; gap: 20px; margin-bottom: 30px; }
            .card { padding: 15px; border: 1px solid #ddd; border-radius: 8px; flex: 1; text-align: center; }
            .status-pass { color: green; font-weight: bold; }
            .status-fail { color: red; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
            th { background-color: #f4f4f4; }
            tr:nth-child(even) { background-color: #fafafa; }
        </style>
    </head>
    <body>
        <h1>📊 Device Audit Report</h1>
        
        <div class="summary-box">
            <div class="card">
                <h3>WS Sent (Bundles)</h3>
                <p style="font-size: 24px;">${wsSent}</p>
            </div>
            <div class="card">
                <h3>Expected DB Rows</h3>
                <p style="font-size: 24px;">${wsSent * 4}</p>
            </div>
            <div class="card">
                <h3>Actual DB Rows</h3>
                <p style="font-size: 24px;">${dbTotal}</p>
            </div>
        </div>

        <h2>✅ API Connectivity Checks</h2>
        <table>
            <tr>
                <th>Test Case</th>
                <th>Result</th>
            </tr>
            <tr>
                <td>Device Retrieval (GET /api/v1/device)</td>
                <td class="${retrieved === 50 ? 'status-pass' : 'status-fail'}">
                    ${retrieved === 50 ? 'OK (50 Found)' : 'FAILED (' + retrieved + ' Found)'}
                </td>
            </tr>
            <tr>
                <td>Individual Measurement Connections</td>
                <td class="${connections === 50 ? 'status-pass' : 'status-fail'}">
                    ${connections}/50 Successful
                </td>
            </tr>
        </table>

        <h2>📱 Individual Device Data Count</h2>
        <p><i>Note: Based on SELECT imei, COUNT(*) FROM device_monitor_log GROUP BY imei;</i></p>
        <table>
            <tr>
                <th>Device IMEI</th>
                <th>Rows in Database</th>
                <th>Status</th>
            </tr>`;

    // 3. Loop through individual device results
    // (You'll need to pass an array of results from teardown if you want the exact list here)
    // For now, this shows the logic:
    html += `<tr><td>Example: 205029787461234</td><td>800</td><td class="status-pass">MATCH</td></tr>`;

    html += `
        </table>
    </body>
    </html>`;

    return {
        'audit_report.html': html,
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}