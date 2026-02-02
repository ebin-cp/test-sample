import server from "./services/servers/http.js";
import logfmt from "./utils/logfmt.js";
import dotenv from "dotenv";

dotenv.config();

const port = process.env.SOCKET_PORT;
server.listen(`${port}`, () => {
    logfmt("info", {
        event: "Server Started",
        port: port,
    });
});
