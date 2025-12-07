import * as mariadb from "mariadb";
import { URL } from "node:url";

const connectionUrl = `${process.env.DATABASE_URL}`;
const parsedUrl = URL.parse(connectionUrl);

const pool = mariadb.createPool({
    host: parsedUrl?.protocol.replace(":", ""),
    port: Number(parsedUrl?.port),
    user: parsedUrl?.username,
    database: parsedUrl?.host.split(":")[0],
    password: parsedUrl?.password,
    connectionLimit: 5,
});

const connection = await pool.getConnection();

export default connection

