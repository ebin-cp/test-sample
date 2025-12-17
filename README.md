# IoT Device Server

A real-time IoT data collection server that accepts device connections via WebSocket and HTTP, storing time-series data in InfluxDB line protocol format.

## Features

- **Device Registration**: Secure device registration with API key generation
- **Real-time Data Ingestion**: WebSocket support for live data streaming
- **Time-series Data Storage**: Store measurements in InfluxDB line protocol format
- **Query API**: Retrieve historical device measurements
- **Containerized Deployment**: Docker Compose setup for easy deployment

## Architecture

- **Runtime**: Node.js (Latest LTS)
- **Database**: MariaDB
- **Reverse Proxy**: Nginx
- **Protocols**: HTTP/REST, WebSocket

## Quick Start

### Prerequisites

- Docker
- Docker Compose

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
    "key": {
        "key": "<api-key",
        "created_at": "<timestamp>"
    }
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

// Send data in InfluxDB line protocol
ws.send('temperature,device=sensor1 value=23.5 1609459200000000000');
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

**Example**:

```
http://localhost:8883/api/v1/device
```

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
|500ms|1 minute|5,900|5,900|100%|✓ Stable|
|450ms|1 minute|6,550|6,550|100%|✓ Stable|
|400ms|1 minute|7,348|7,348|100%|✓ Stable|
|375ms|1 minute|7,850|7,850|100%|✓ Stable|
|350ms|1 minute|8,300|8,300|100%|✓ Stable|
|320ms|1 minute|9,099|9,099|100%|✓ Stable|
|310ms|1 minute|9,500|9,500|100%|✓ Stable|
|300ms|1 minute|9,650|8,390|86.9%|⚠ Message Loss|

**Test Configuration:**

- **Concurrent Devices**: 50
- **Simultaneous Transmission**: All 50 devices sending messages concurrently
- **Infrastructure**: Containerized deployment (MariaDB, Nginx, Node.js)