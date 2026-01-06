import dbConnection from "../db-connection/db-connection.js";
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
	console.log("Authentication running for client ", imei, key);
	const connection = await dbConnection();
	const rows = await connection
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
