function flattenObject(source, prefix = "") {
    return Object.keys(source).reduce((acc, key) => {
        const propertyPath = prefix ? `${prefix}.${key}` : key;
        const val = source[key];

        if (val !== null && typeof val === "object" && !Array.isArray(val)) {
            Object.assign(acc, flattenObject(val, propertyPath));
        } else {
            acc[propertyPath] = Array.isArray(val) ? `[${val.join(", ")}]` : val;
        }
        return acc;
    }, {});
}

function logfmt(level, details = {}) {
    const flatDetails = flattenObject(details);
    const logEntry = {
        level,
        ...flatDetails,
        timestamp: new Date().toISOString(),
    };

    const output = Object.entries(logEntry)
        .map(([key, value]) => {
            if (!value) {
                return '';
            }
            let stringValue = String(value);
            if (/[ " =]/.test(stringValue)) {
                stringValue = `"${stringValue.replace(/"/g, '\\"')}"`;
            }
            return `${key}=${stringValue}`;
        })
        .join(" ");

    console.log(output);
}

export default logfmt;
