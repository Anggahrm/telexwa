import fs from 'fs';

export function createDatabase(phoneNumber) {
    if (!fs.existsSync('./databases')) {
        fs.mkdirSync('./databases');
    }
    
    if (!fs.existsSync('./uploads')) {
        fs.mkdirSync('./uploads');
    }
    
    const database = {};
    fs.writeFileSync(`./databases/database-${phoneNumber}.json`, JSON.stringify(database, null, 2));
}

export function readDatabase(phoneNumber) {
    if (fs.existsSync(`./databases/database-${phoneNumber}.json`)) {
        return JSON.parse(fs.readFileSync(`./databases/database-${phoneNumber}.json`));
    }
    return null;
}