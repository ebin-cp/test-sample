import * as mariadb from "mariadb";
import { URL } from "node:url";

const connectionUrl = `${process.env.DATABASE_URL}`;
const parsedUrl = URL.parse(connectionUrl);
let connection: mariadb.PoolConnection | null = null;

async function db_connection(): Promise<mariadb.PoolConnection> {
    if (connection) {
        return connection;
    }
    const pool = mariadb.createPool({
        host: parsedUrl?.protocol.replace(":", ""),
        port: Number(parsedUrl?.port),
        user: parsedUrl?.username,
        database: parsedUrl?.host.split(":")[0],
        password: parsedUrl?.password,
        connectionLimit: 5,
    });

    pool.on("connection", (conn) => {
        conn.on("error", (err) => {
            console.log("\nDatabase connection error\n", err);
        });
    });

    connection = await pool.getConnection();
    return connection;
}

export default db_connection;
