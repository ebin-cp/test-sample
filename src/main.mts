import server from "./services/servers/websocket.mjs";

const port = process.env.SOCKET_PORT;
server.listen(`${port}`);
