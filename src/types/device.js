import z from "zod";

export const DEVICE_SCHEMA = z.object({
    deviceId: z.string(),
    imei: z.string().regex(/^\d{15,16}$/),
    api_keys: z.object({
        key: z.string(),
        created_at: z.number,
    }),
    presence: z.string(),
    fields: z
        .object({
            key: z.string(),
            value: z.union([z.string(), z.number()]),
            modified_at: z.number(),
        })
        .array(),
    created_at: z.number(),
    modified_at: z.number(),
});

export const DEVICE_MONITOR_LOG_SCHEMA = z.object({
    id: z.string(),
    imei: z.string().regex(/^\d{15,16}$/),
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

export const TRUCK_INFO_INPUT_SCHEMA = z.strictObject({
    truck_reg_no: z
        .string()
        .regex(/^[A-Za-z0-9]{4,15}$/)
        .toUpperCase(),
    truck_tank_volume: z.number().min(100).max(100000),
    truck_tank_volume_mapping: z
        .string()
        .min(3)
        .regex(/^(\d+,\d+(\.\d+)?(\r?\n|$)){3,100}$/)
        .optional(),
});
