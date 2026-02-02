import dbConnectionPool from "../db-connection/db-connection.js";
import logfmt from "../../utils/logfmt.js";

async function authenticate(request, next) {
    if (request.headers.origin !== "robad.in") {
        next(new Error("Unauthorized"), request);
        return;
    }
    if (!request.headers.authorization) {
        next(new Error("Unauthorized"), request);
        return;
    }
    const [imei, key] = request.headers.authorization.split(" ");
    logfmt("info", {
        event: "Device Authentication",
        imei: imei,
        api_key: key,
    });
    const rows = await dbConnectionPool
        .query(
            `SELECT imei FROM devices WHERE JSON_EXTRACT(api_keys,'$.key')=? AND imei=?`,
            [key, imei],
        )
        .catch((err) => {
            next(err, request);
        });
    if (!rows || !rows.length) {
        next(new Error("Unauthorized"), request);
    }
    next(null, request);
}

export default authenticate;
