import z from "zod";
export const DEVICE_SCHEMA = z.object({
    deviceId: z.string(),
    imei: z.string(),
    api_keys: z.object({
        key: z.string(),
        created_at: z.number,
    }),
    presence: z.string(),
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
    created_at: z.number(),
    modified_at: z.number(),
});
export const DEVICE_MONITOR_LOG_SCHEMA = z.object({
    id: z.string(),
    imei: z.string(),
    measurement: z.string(),
    tags: z.object({
        key: z.string(),
        value: z.union([z.string(), z.number()]),
    }),
    fields: z.object({
        key: z.string(),
        value: z.union([z.string(), z.number()]),
    }),
    timestamp: z.number(),
});
