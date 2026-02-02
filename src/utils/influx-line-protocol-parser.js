import { spawn } from "node:child_process";
import { INFLUX_LINE_PROTOCOL_PARSED } from "../types/message.js";
import z from "zod";
import logfmt from "./logfmt.js";

const influx_line_protocol_parser = (msg) => {
    if (!msg) {
        reject({ res: [], err: new Error("Invalid message") });
    }
    const d = spawn("libs/line_decoder", [msg], {
        shell: false,
    });
    return new Promise((resolve, reject) => {
        d.stdout.on("data", (data) => {
            const res = data.toString();
            if (!res.startsWith("[")) {
                logfmt("error", {
                    event: "Influx line protocol parser",
                    msg: "Invalid JSON",
                    data: res,
                });
                reject({ res: [], err: new Error(res) });
                return;
            }
            const res_json = JSON.parse(res);
            const validate = INFLUX_LINE_PROTOCOL_PARSED.array().safeParse(res_json);
            if (validate.error) {
                logfmt("error", {
                    event: "Influx line protocol parser",
                    msg: "Zod validation",
                    ...z.treeifyError(validate.error),
                });
                reject({ res: [], err: new Error(validate.error.message) });
                return;
            }
            if (validate.data) {
                resolve({ res: validate.data });
                return;
            }
            reject({ res: [], err: new Error("Unexpected error") });
            return;
        });
        d.stderr.on("data", (data) => {
            reject({ res: [], err: new Error(data) });
            return;
        });
        d.on("error", (data) => {
            reject({ res: [], err: new Error(data.message) });
            return;
        });
    });
};
export default influx_line_protocol_parser;
