const { getDatabase } = require("../models/database");

function getSetting(key) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT key, value, encrypted, updated_at FROM app_settings WHERE key = ?",
            [key],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || null);
                }
            }
        );
    });
}

function setSetting(key, value, { encrypted = 0 } = {}) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        db.run(
            `
            INSERT INTO app_settings (key, value, encrypted, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                encrypted = excluded.encrypted,
                updated_at = datetime('now')
        `,
            [key, value, encrypted ? 1 : 0],
            function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            }
        );
    });
}

async function getSettingValue(key, defaultValue = null) {
    const setting = await getSetting(key);
    if (!setting || setting.value === null || setting.value === undefined) {
        return defaultValue;
    }
    return setting.value;
}

async function setSettingValue(key, value, options = {}) {
    return setSetting(key, value, options);
}

async function getSettings(keys) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        const placeholders = keys.map(() => "?").join(",");
        db.all(
            `SELECT key, value, encrypted, updated_at FROM app_settings WHERE key IN (${placeholders})`,
            keys,
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const map = {};
                    rows.forEach((row) => {
                        map[row.key] = row;
                    });
                    resolve(map);
                }
            }
        );
    });
}

module.exports = {
    getSetting,
    setSetting,
    getSettingValue,
    setSettingValue,
    getSettings,
};


