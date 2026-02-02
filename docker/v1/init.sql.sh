#!/bin/bash

export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"

mysql -u root<<EOF
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\`;
USE \`$DB_NAME\`;

CREATE TABLE IF NOT EXISTS devices (
    deviceId VARCHAR(30) PRIMARY KEY,
    imei VARCHAR(50) UNIQUE NOT NULL,
    presence VARCHAR(100) NOT NULL,
    api_keys JSON,
    fields JSON,
    created_at BIGINT NOT NULL,
    modified_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_monitor_log (
    imei VARCHAR(50) NOT NULL,
    measurement VARCHAR(255) NOT NULL,
    fields JSON,
    tags JSON,
    timestamp BIGINT NOT NULL,

    PRIMARY KEY (imei, measurement, timestamp),

    CONSTRAINT fk_device_imei
        FOREIGN KEY (imei)
        REFERENCES devices (imei)
);

CREATE INDEX idx_log_imei_timestamp
ON device_monitor_log (imei, timestamp);

CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_USER_PASSWD';

GRANT
    SELECT,
    INSERT,
    UPDATE,
    DELETE
ON \`$DB_NAME\`.* TO '$DB_USER'@'%';

FLUSH PRIVILEGES;
EOF
