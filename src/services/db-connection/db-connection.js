import * as mariadb from "mariadb";
let connection = null;
async function dbConnection() {
    if (connection) {
        return connection;
    }
    const pool = mariadb.createPool({
        host: `${process.env.DATABASE_HOST}`,
        port: Number(`${process.env.DATABASE_PORT}`),
        user: `${process.env.DATABASE_USER}`,
        database: `${process.env.DATABASE_NAME}`,
        password: `${process.env.DATABASE_USER_PASSWORD}`,
        connectionLimit: 10,
        allowPublicKeyRetrieval: true,
    });
    pool.on("connection", (conn) => {
        conn.on("error", (err) => {
            console.log("\nDatabase connection error\n", err);
        });
    });
    connection = await pool.getConnection();
    return connection;
}
export default dbConnection;
