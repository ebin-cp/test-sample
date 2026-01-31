import http from "k6/http";

export function createDevices(count = 400) {
    const deviceKeys = [];
    const generateIMEI = () => Array.from({length: 15}, () => Math.floor(Math.random() * 10)).join("");

    for (let i = 0; i < count; i++) {
        const imei = generateIMEI(); 
        const res = http.post("http://localhost:8883/api/v1/device", 
            JSON.stringify({ imei }), 
            { headers: { "Content-Type": "application/json" } }
        );

        if (res.status === 200 || res.status === 201) {
            const d = res.json();
            const apiKey = d.key && d.key.key ? d.key.key : (d.key ? d.key : null);
            if (apiKey) deviceKeys.push({ api_key: apiKey, imei: imei });
        }
    }
    return deviceKeys;
}