import fs from 'fs';
import config from '../config.js';

class TelegramDatabase {
    constructor() {
        this.data = {
            users: {},
            settings: {
                roles: {
                    free: { limit: 1 },
                    premium: { limit: 2 },
                    vip: { limit: 3 },
                    vvip: { limit: 5 },
                    developer: { limit: Infinity } // Developer role with unlimited bots
                }
            }
        };
        this.loadDatabase();
    }

    loadDatabase() {
        const dbPath = './databases/telegram';
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
                
                // Ensure developer role exists after loading
                if (!this.data.settings.roles.developer) {
                    this.data.settings.roles.developer = { limit: Infinity };
                    this.saveDatabase();
                }
            } else {
                this.saveDatabase();
            }
        } catch (error) {
            console.error('Error loading Telegram database:', error);
            this.saveDatabase();
        }
    }

    saveDatabase() {
        try {
            const dbPath = './databases/telegram';
            fs.writeFileSync(
                `${dbPath}/database.json`,
                JSON.stringify(this.data, null, 2)
            );
        } catch (error) {
            console.error('Error saving Telegram database:', error);
        }
    }

    // User management
    getUser(userId) {
        if (!this.data.users[userId]) {
            this.data.users[userId] = {
                role: userId === config.telegram.ownerId ? 'developer' : 'free',
                bots: [],
                joinDate: new Date().toISOString()
            };
            this.saveDatabase();
        }
        return this.data.users[userId];
    }

    setUserRole(userId, role) {
        const user = this.getUser(userId);
        // Prevent changing developer's role
        if (userId === config.telegram.ownerId && role !== 'developer') {
            return user;
        }
        user.role = role;
        this.saveDatabase();
        return user;
    }

    addUserBot(userId, phoneNumber) {
        const user = this.getUser(userId);
        if (!user.bots.includes(phoneNumber)) {
            user.bots.push(phoneNumber);
            this.saveDatabase();
        }
        return user;
    }

    removeUserBot(userId, phoneNumber) {
        const user = this.getUser(userId);
        user.bots = user.bots.filter(bot => bot !== phoneNumber);
        this.saveDatabase();
        return user;
    }

    getUserBots(userId) {
        const user = this.getUser(userId);
        return user.bots;
    }

    isDeveloper(userId) {
        const user = this.getUser(userId);
        return user.role === 'developer';
    }

    // Role management
    getRoleLimit(role) {
        return this.data.settings.roles[role]?.limit || 0;
    }

    canAddMoreBots(userId) {
        const user = this.getUser(userId);
        if (user.role === 'developer') return true; // Developers can always add more bots
        const limit = this.getRoleLimit(user.role);
        return user.bots.length < limit;
    }

    // Settings management
    updateRoleLimit(role, limit) {
        if (role === 'developer') return; // Prevent modifying developer role limit
        if (!this.data.settings.roles[role]) {
            this.data.settings.roles[role] = {};
        }
        this.data.settings.roles[role].limit = limit;
        this.saveDatabase();
    }
}

// Create a singleton instance
const telegramDb = new TelegramDatabase();

export default telegramDb;