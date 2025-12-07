import z from "zod";
import { DEVICE_SCHEMA } from "../types/device.mjs";

export function influx_line_protocol_parser(msg: string) {
    const stage0 = msg.replaceAll('"', "").split(" ");
    if (!stage0[0]) {
        return;
    }
    const stage1 = stage0[0].split(",");
    if (!stage1.length) {
        return;
    }
    const stage2 = stage1.splice(1);
    if (!stage0[1]) {
        return;
    }
    const stage3 = stage0[1].split(",");

    type KeyValueMap = z.infer<typeof DEVICE_SCHEMA.shape.fields>;

    const fields: KeyValueMap = [];
    const tags: KeyValueMap = [];

    if (stage2.length) {
        for (const f of stage2) {
            const data_map = f.split("=");
            if (!data_map.length) {
                continue;
            }
            fields.push({
                key: `${data_map[0]}`,
                value: Number.parseFloat(`${data_map[1]}`)
                    ? Number.parseFloat(`${data_map[1]}`)
                    : `${data_map[1]}`,
            });
        }
    }

    if (stage3.length) {
        for (const t of stage3) {
            const data_map = t.split("=");
            if (!data_map.length) {
                continue;
            }
            tags.push({
                key: `${data_map[0]}`,
                value: Number.parseFloat(`${data_map[1]}`)
                    ? Number.parseFloat(`${data_map[1]}`)
                    : `${data_map[1]}`,
            });
        }
    }

    return {
        measurement: stage1[0],
        fields: fields,
        tags: tags,
        timestamp: Number(stage0[1]),
    };
}
