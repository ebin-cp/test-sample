export const deviceInsertion = `
INSERT INTO devices (deviceId, imei, api_keys,fields,presence,created_at,modified_at) VALUES (?,?,?,?,?,?,?);
`;

export const deviceMonitorLogInsertion = `
INSERT INTO device_monitor_log (imei, measurement,tags,fields,timestamp) 
VALUES (?,?,?,?,?)
ON DUPLICATE KEY UPDATE
    tags = ?,
    fields = ?;
`;

export const deviceExistence = `
SELECT COUNT(*) as count 
FROM devices
WHERE
    imei=?
`;

export const getDevices = `
SELECT 
    imei,api_keys,presence,fields 
FROM devices;`;

export const getOneDevice = `
SELECT 
    imei,api_keys,presence,fields 
FROM devices 
WHERE imei=?;`;

export const deviceMonitorLogQuery = `
SELECT 
    imei,
    measurement,
    tags,fields,
    DATE_FORMAT(FROM_UNIXTIME(timestamp / 1000000000), '%Y-%m-%dT%T.%f') AS iso_time 
FROM device_monitor_log 
WHERE 
    imei=? 
    AND measurement=? 
    AND timestamp BETWEEN ? AND ? 
ORDER BY timestamp ASC LIMIT 1000;
`;

export const updateDevicePresence = `
UPDATE devices SET presence = CONCAT(?,' ', UNIX_TIMESTAMP() * 1000) WHERE imei = ?;
`;

export const getDeviceFields = `
SELECT 
    JSON_UNQUOTE(JSON_EXTRACT(fields, CONCAT(REPLACE(JSON_UNQUOTE(JSON_SEARCH(fields, 'one',?, NULL, '$[*].key')), '.key', ''), '.value'))) AS dev_field
FROM devices
WHERE
    imei=?;
`;

export const truckInfoValueExistence = `
SELECT 
    COUNT(*) as count
FROM devices 
WHERE
    JSON_UNQUOTE(JSON_EXTRACT(fields, CONCAT(REPLACE(JSON_UNQUOTE(JSON_SEARCH(fields, 'one',?, NULL, '$[*].key')), '.key', ''), '.value'))) = ?
    AND imei != ?;
    `;

export const truckInfoElementIndex = `
SELECT 
    JSON_UNQUOTE(JSON_SEARCH(fields, 'one', ?, NULL, '$[*].key')) AS path, 
    JSON_UNQUOTE(JSON_EXTRACT(fields, CONCAT(REPLACE(JSON_UNQUOTE(JSON_SEARCH(fields, 'one',?, NULL, '$[*].key')), '.key', ''), '.value'))) AS current_value
FROM devices 
WHERE 
    imei = ?; 
    `;

export const updateDeviceFields = `
UPDATE devices SET fields = JSON_SET(fields, ?, JSON_OBJECT('key', ?, 'value', ?, 'modified_at', ?)) WHERE imei = ?;
`;

export const insertDeviceFields = `
UPDATE devices SET fields = JSON_ARRAY_APPEND(IF(JSON_LENGTH(fields) > 0,fields,'[]'), '$', JSON_OBJECT('key', ?, 'value', ?, 'modified_at', ?)) WHERE imei = ?;
`;

export const deassignTruck = `
UPDATE devices 
SET fields = JSON_REMOVE(
  fields, 
  REPLACE(JSON_UNQUOTE(JSON_SEARCH(fields, 'one', ?, NULL, '$[*].key')), '.key', '')
) 
WHERE imei = ?;
`;
