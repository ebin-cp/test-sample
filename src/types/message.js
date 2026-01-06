import z from "zod";
export const INFLUX_LINE_PROTOCOL_SCHEMA = z.string({
    message: "Message should be in plain text",
});
export const DEVICE_DIRECTIVES = z
    .string({ message: "Invalid directive" })
    .regex(/^(GET|SYNC):(CALIBRATION|FIRMWARE):[a-zA-Z0-9._-]+$/);
export const INFLUX_LINE_PROTOCOL_PARSED = z.object({
    measurement: z.string(),
    tags: z
        .object({
            key: z.string(),
            value: z.union([z.string(), z.number()]),
        })
        .array(),
    fields: z
        .object({
            key: z.string(),
            value: z.union([z.string(), z.number()]),
        })
        .array(),
    timestamp: z.number(),
});
