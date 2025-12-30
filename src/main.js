import server from "./services/servers/http.js";
const port = process.env.SOCKET_PORT;
server.listen(`${port}`, () => {
    console.log("Server Started");
});
