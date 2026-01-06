# IoT Device Server

A real-time IoT data collection server that accepts device connections via WebSocket and HTTP, storing time-series data.

## Architecture

- **Runtime**: Node.js (Latest LTS)
- **Database**: MySQL
- **Reverse Proxy**: Nginx
- **Protocols**: HTTP/REST, WebSocket

## Quick Start

### Prerequisites

- Docker
- Docker Compose
- .env file at docker/v1/
  ```
  DATABASE_ROOT_PASSWORD=<Root Database Password>
  DATABASE_USER=<Database Username>
  DATABASE_USER_PASSWORD=<Database User Password>
  DATABASE_NAME=<Database Name>
  DATABASE_HOST=<Database Host (localhost,172.xx.xx.xx, ....)>
  DATABASE_PORT=<Database Port>
  ```

### Running the Server

```bash
docker compose -f ./docker/v1/docker-compose.yml up --build
```

The server will be available at `http://localhost:8883`

## API Reference

### 1. Device Registration

Register a new device and receive an API key.

**Endpoint**: `POST http://localhost:8883/api/v1/device`

**Request Body**:

```json
{
  "imei": "your-device-imei"
}
```

**Response**:

```json
{
    "key": "<api-key",
    "created_at": "<timestamp>"
}
```

### 2. WebSocket Connection

Connect your device to stream real-time data in InfluxDB line protocol format.

**Endpoint**: `ws://localhost:8883/api/live`

**Headers**:

- `Origin`: `robad.in`
- `Authorization`: `<imei> <api_key>`

**Example**:

```javascript
const ws = new WebSocket('ws://localhost:8883/api/live', {
  headers: {
    'Origin': 'robad.in',
    'Authorization': '3574920816425739 your-api-key-here'
  }
});

// Send measurements in InfluxDB line protocol
ws.send('temperature,device=sensor1 value=23.5 1609459200000000000');

// Send device directives in this schema (ACTION:TARGET:VERSION or ID) to recieve data from server 
// Current supported values or regex ^(GET|SYNC):(CALIBRATION|FIRMWARE):[a-zA-Z0-9._-]+$
ws.send('SYNC:CALIBRATION:volume');
ws.send('GET:FIRMWARE:latest'); // not implemented yet.
```

**InfluxDB Line Protocol Format**:

```
measurement[,tag=value...] field=value[,field=value...] [timestamp]
```

Example:

```
cellular,device_id=3574920816425739 signal_strength=-75,network_type="4G" 1765178700000000000
```

For detailed information on InfluxDB line protocol syntax, refer to the [official InfluxDB documentation](https://docs.influxdata.com/influxdb/v2/reference/syntax/line-protocol/).

### 3. Query Measurements

Retrieve historical measurements for a specific device.

**Endpoint**: `GET http://localhost:8883/api/v1/device/measurements`

**Query Parameters**:

- `imei` (required): Device IMEI
- `measurement` (required): Measurement name (e.g., "cellular", "temperature")
- `start_ns` (required): Start time in nanoseconds
- `end_ns` (required): End time in nanoseconds

**Example**:

```
http://localhost:8883/api/v1/device/measurements?imei=3574920816425739&measurement=cellular&start_ns=1765178700000000000&end_ns=1765178700000000000
```

### 4. List All Devices

Retrieve a list of all registered devices.

**Endpoint**: `GET http://localhost:8883/api/v1/device`

### 5. Assign Truck To Device

Retrieve a list of all registered devices.

**Endpoint**: `PUT http://localhost:8883/api/v1/device/assign-truck`

**Query Parameters**:

- `imei` (required): Device IMEI

**Request Body**:

```json
{
    "truck_reg_no":"<Truck Registration Number>",
    "truck_tank_volume":"<Truck Volume in integer>",
    "truck_tank_volume_mapping":"<Truck Volume Mapping in csv format>", // "1,100.2\n2,200.2\n"
}
```

### 6. De-Assign Truck To Device

Retrieve a list of all registered devices.

**Endpoint**: `PUT http://localhost:8883/api/v1/device/deassign-truck`

**Query Parameters**:

- `imei` (required): Device IMEI


## Timestamp Format

All timestamps are in nanoseconds since Unix epoch. To convert from JavaScript Date:

```javascript
const timestampNs = Date.now() * 1000000; // milliseconds to nanoseconds
```

## Security Notes

- Store API keys securely on your devices
- Use the correct Origin header (`robad.in`) when connecting via WebSocket
- API keys are required for all device communications

## Performance

### Load Test Results

The server has been tested with 50 concurrent WebSocket connections under various message intervals:

|Message Interval|Test Duration|Messages Sent|Messages Received|Success Rate|Status|
|---|---|---|---|---|---|
|500ms|10 minute|62950|251800|100%|✓ Stable|
|400ms|10 minute|78700|314800|100%|✓ Stable|
|300ms|10 minute|104950|419800|100%|✓ Stable|
|200ms|10 minute|157042|43477|6.9%|⚠ Message Loss|
|100ms|10 minute|1256316|13886|0.2%|⚠ Message Loss|

> **NOTE**: The test message contains volume,cellular log,firmware info and battery log so the database will have four times the number of rows since we can send multiple measurements in one message and each measurement will be inserted as separate rows.

**Test Configuration:**

- **Concurrent Devices**: 50
- **Simultaneous Transmission**: All 50 devices sending messages concurrently
- **Infrastructure**: Containerized deployment (MySQL, Nginx, Node.js)
