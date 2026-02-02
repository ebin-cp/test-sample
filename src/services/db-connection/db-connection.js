import * as mariadb from "mariadb";
import logfmt from "../../utils/logfmt.js";
import dotenv from 'dotenv'

dotenv.config()

const dbConnectionPool = mariadb.createPool({
    host: `${process.env.DATABASE_HOST}`,
    port: Number(`${process.env.DATABASE_PORT}`),
    user: `${process.env.DATABASE_USER}`,
    database: `${process.env.DATABASE_NAME}`,
    password: `${process.env.DATABASE_USER_PASSWORD}`,
    connectionLimit: 10,
    allowPublicKeyRetrieval: true,
    idleTimeout:0
});
dbConnectionPool.on("connection", (conn) => {
    conn.on("error", (err) => {
        logfmt("error", {
            event: "Database Connection",
            msg: err,
        });
    });
});

export default dbConnectionPool;
