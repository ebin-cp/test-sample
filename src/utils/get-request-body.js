function getRequestBody(req) {
	return new Promise((resolve, reject) => {
		let reqBody = "";
		req.on("error", (err) => {
			reject(err);
		});
		req.on("data", (chunk) => {
			reqBody += chunk.toString();
		});
		req.on("end", () => {
			resolve(reqBody);
		});
	});
}
export default getRequestBody;
