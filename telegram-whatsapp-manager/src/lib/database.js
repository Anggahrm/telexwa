import fs from 'fs';

class Database {
    constructor(phoneNumber) {
        this.phoneNumber = phoneNumber;
        this.data = {
            chats: {},
            users: {}
        };
        this.loadDatabase();
    }

    loadDatabase() {
        const dbPath = `./databases/${this.phoneNumber}`;
        if (!fs.existsSync('./databases')) {
            fs.mkdirSync('./databases');
        }
        if (!fs.existsSync(dbPath)) {
            fs.mkdirSync(dbPath);
        }

        const dbFile = `${dbPath}/database.json`;
        try {
            if (fs.existsSync(dbFile)) {
                const data = fs.readFileSync(dbFile, 'utf8');
                this.data = JSON.parse(data);
            } else {
                this.saveDatabase();
            }
        } catch (error) {
            console.error(`Error loading database for ${this.phoneNumber}:`, error);
            this.saveDatabase();
        }
    }

    saveDatabase() {
        try {
            const dbPath = `./databases/${this.phoneNumber}`;
            fs.writeFileSync(
                `${dbPath}/database.json`,
                JSON.stringify(this.data, null, 2)
            );
        } catch (error) {
            console.error(`Error saving database for ${this.phoneNumber}:`, error);
        }
    }

    initChat(chatId) {
        if (!this.data.chats[chatId]) {
            this.data.chats[chatId] = {
                isBanned: false,
                listStr: {},
                welcome: true,
                detect: true,
                delete: true
            };
            this.saveDatabase();
        }
        return this.data.chats[chatId];
    }

    initUser(userId) {
        if (!this.data.users[userId]) {
            this.data.users[userId] = {
                banned: false,
                name: '',
                registered: false,
                premium: false
            };
            this.saveDatabase();
        }
        return this.data.users[userId];
    }
}

const databases = new Map();

export function getDatabase(phoneNumber) {
    if (!databases.has(phoneNumber)) {
        databases.set(phoneNumber, new Database(phoneNumber));
    }
    return databases.get(phoneNumber);
}

export function deleteDatabase(phoneNumber) {
    databases.delete(phoneNumber);
    const dbPath = `./databases/${phoneNumber}`;
    if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { recursive: true, force: true });
    }
}