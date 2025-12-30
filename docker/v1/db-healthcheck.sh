#!/bin/bash

export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"

if mysql -u root -e "USE \`$DB_NAME\`" > /dev/null 2>&1; then
    exit 0
else
    exit 1
fi
