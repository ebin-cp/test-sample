import z from "zod";

export const INFLUX_LINE_PROTOCOL_SCHEMA = z
    .string({ message: "Message should be in plain text" })
    .regex(
        /^([^,\s]+(?:,[^=]+=[^,]+)*)\s+([^,\s]+=[^\s,]+(?:,[^=]+=[^\s,]+)*)(?:\s+(\d+))?$/,
        { message: "Messages should be formatted Influx Line Protocol" },
    );

export type InfluxLineProtocol = z.infer<typeof INFLUX_LINE_PROTOCOL_SCHEMA>;
