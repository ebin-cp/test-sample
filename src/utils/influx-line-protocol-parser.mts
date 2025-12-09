import { spawn } from "node:child_process";
import {
    INFLUX_LINE_PROTOCOL_PARSED,
    type InfluxLineParsed,
} from "../types/message.mjs";

const influx_line_protocol_parser = (
    msg: string,
): Promise<{ res: InfluxLineParsed[]; err?: Error }> => {
    const d = spawn("/bin/bash", ["-c", `libs/line_decoder '${msg}'`]);
    return new Promise((resolve, reject) => {
        d.stdout.on("data", (data) => {
            const res: string = data.toString();
            if (!res.startsWith("[")) {
                console.log("Invalid JSON\n", res);
                reject({ res: [], err: new Error(res) });
                return;
            }
            const res_json = JSON.parse(res);
            const validate = INFLUX_LINE_PROTOCOL_PARSED.array().safeParse(res_json);
            if (validate.error) {
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
