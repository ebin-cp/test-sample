import http from "k6/http";

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

export function generateRandomTruckData(imei) {
    const truckID = imei.slice(-4);
    const vol = randomInt(500, 1000);
    const mapping = `1,${vol * 0.1}\n2,${vol * 0.5}\n3,${vol}`;
    
    return {
        "truck_reg_no": `KLTR${truckID}${randomInt(10, 99)}`,
        "truck_tank_volume": vol,
        "truck_tank_volume_mapping": mapping
    };
}

export function assignTruck(imei, apiKey, truckData) {
    const url = `http://localhost:8883/api/v1/device/assign-truck?imei=${imei}`;
    const params = { headers: { "Authorization": apiKey, "Content-Type": "application/json" } };
    const res = http.put(url, JSON.stringify(truckData), params);
    if (res.status !== 200){
        console.log(`Assign Fail for ${imei}:Status ${res.status} Body:${res.body}`);
    }
    return res;
}

export function deassignTruck(imei, apiKey) {
    const url = `http://localhost:8883/api/v1/device/deassign-truck?imei=${imei}`;
    return http.put(url, null, { headers: { "Authorization": apiKey } });
}

export function getDeviceDetails(imei, apiKey) {
    const url = `http://localhost:8883/api/v1/device?imei=${imei}`;
    const res = http.get(url, { headers: { "Authorization": apiKey } });
    let fields = [];
    if (res.status === 200) {
        const body = res.json();
        const device = Array.isArray(body) ? body.find(d => d.imei === imei) : body;
        fields = device ? device.fields : [];
    }
    return { status: res.status, fields: fields };
}