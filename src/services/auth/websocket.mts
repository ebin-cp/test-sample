import type { IncomingMessage } from "node:http";
import type { AuthCallback } from "../../types/websocket.mjs";

function authenticate(
    request: IncomingMessage,
    next: AuthCallback<IncomingMessage>,
) {
    if (request.headers.origin !== "robad.in") {
        next(new Error("Unauthorized"), request);
    }
    next(null, request);
}

export default authenticate;
