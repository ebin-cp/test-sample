import type { IncomingMessage } from "node:http";
import type { AuthCallback } from "../../types/websocket.mjs";
import db_connection from "../db-connection/db-connection.mjs";

async function authenticate(
    request: IncomingMessage,
    next: AuthCallback<IncomingMessage>,
) {
    if (request.headers.origin !== "robad.in") {
        next(new Error("Unauthorized"), request);
        return;
    }
    if (!request.headers.authorization) {
        next(new Error("Unauthorized"), request);
        return;
    }

    const [imei, key] = request.headers.authorization.split(" ");

    console.log("Authentication running for client ", imei, key);
    const connection = await db_connection();
    const validate_auth_key = await connection
        .query(
            `SELECT imei FROM devices WHERE JSON_EXTRACT(api_keys,'$.key')='${key}' AND imei='${imei}'`,
        )
        .catch((err) => {
            console.log(err);
            return 0;
        });
    if (!validate_auth_key || !validate_auth_key.length) {
        next(new Error("Unauthorized"), request);
    }

    next(null, request);
}

export default authenticate;
