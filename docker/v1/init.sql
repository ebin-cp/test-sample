CREATE DATABASE IF NOT EXISTS genrobotics;
USE genrobotics;

CREATE TABLE devices (
    deviceId VARCHAR(30) PRIMARY KEY,
    imei VARCHAR(50) UNIQUE NOT NULL,
    api_keys JSON,
    tags JSON,
    fields JSON,
    created_at BIGINT NOT NULL, -- Nanosecond timestamp
    modified_at BIGINT NOT NULL -- Nanosecond timestamp
);

CREATE TABLE device_volume_sensor_log (
    id VARCHAR(30) PRIMARY KEY,
    imei VARCHAR(50) NOT NULL,
    measurement VARCHAR(255),
    fields JSON,
    tags JSON,
    timestamp BIGINT NOT NULL,

    CONSTRAINT fk_device_imei
        FOREIGN KEY (imei)
        REFERENCES devices (imei)
);

CREATE INDEX idx_log_imei_timestamp
ON device_volume_sensor_log (imei, timestamp);

CREATE USER '01KBW95T0KDJR9DXB76N85YN44'@'%' IDENTIFIED BY '01KBW946RN5ZD4MP9R46R7AP57_01kbw94d5wv0cd4521bw1andra';

GRANT
    SELECT,
    INSERT,
    UPDATE,
    DELETE
ON genrobotics.* TO '01KBW95T0KDJR9DXB76N85YN44'@'%';

FLUSH PRIVILEGES;
