import fs from 'fs';

export function createDatabase(phoneNumber) {
    const database = {};
    fs.writeFileSync(`./databases/database-${phoneNumber}.json`, JSON.stringify(database));
}

export function readDatabase(phoneNumber) {
    if (fs.existsSync(`./databases/database-${phoneNumber}.json`)) {
        return JSON.parse(fs.readFileSync(`./databases/database-${phoneNumber}.json`));
    }
    return null;
}