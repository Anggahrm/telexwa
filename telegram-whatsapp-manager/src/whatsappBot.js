import pkg from '@whiskeysockets/baileys';
const { 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    Browsers, 
    makeInMemoryStore, 
    DisconnectReason,
    generateWAMessage,
    getAggregateVotesInPollMessage,
    areJidsSameUser
} = pkg;
import { Boom } from '@hapi/boom';
import chalk from 'chalk';
import fs from 'fs';
import P from 'pino';
import { getDatabase } from './lib/database.js';
import makeWASocket from './lib/simple.js';
import serialize from './lib/serialize.js';
import { handleStoredMessage, handleCommand } from './handlers/case.js';

const store = makeInMemoryStore({
    logger: P().child({
        level: 'silent',
        stream: 'store'
    })
});

console.log(chalk.green.bold(`
    --------------------------------------
    ☘️ WhatsApp Bot Integration Ready
    --------------------------------------
`));

export async function createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus) {
    const { state, saveCreds } = await useMultiFileAuthState(`sessions/${phoneNumber}`);
    const { version } = await fetchLatestBaileysVersion();
    const db = getDatabase(phoneNumber);

    console.log(chalk.yellow.bold("📁     Initializing modules..."));
    console.log(chalk.cyan.bold("- Baileys API Loaded"));
    console.log(chalk.cyan.bold("- File System Ready"));

    const sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu("Edge"),
        getMessage: async (key) => {
            const jid = key.remoteJid;
            const msg = await store.loadMessage(jid, key.id);
            return msg?.message || "";
        }
    }, store);

    store.bind(sock.ev);

    if (!sock.authState.creds.registered) {
        try {
            await sock.waitForConnectionUpdate((up) => !!up.qr);
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(chalk.white.bold(`Pairing code for ${phoneNumber}: ${code}`));
            sendPairingCodeToTelegram(phoneNumber, code);
        } catch (error) {
            console.error(chalk.red.bold(`Failed to request pairing code for ${phoneNumber}:`, error));
            return null;
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        updateStatus(phoneNumber, connection || 'offline');
        
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            console.log(chalk.red.bold("Connection closed due to: "), lastDisconnect.error);

            if (reason === DisconnectReason.badSession) {
                console.log(chalk.red.bold("Bad session file, please delete session and scan again"));
                deleteSession(phoneNumber);
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log(chalk.yellow.bold("Connection closed, reconnecting..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            } else if (reason === DisconnectReason.connectionLost) {
                console.log(chalk.yellow.bold("Connection lost, trying to reconnect..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log(chalk.green.bold("Connection replaced, another session opened"));
                sock.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(chalk.green.bold("Device logged out, please scan again"));
                deleteSession(phoneNumber);
            } else if (reason === DisconnectReason.restartRequired) {
                console.log(chalk.green.bold("Restart required, restarting..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            } else if (reason === DisconnectReason.timedOut) {
                console.log(chalk.green.bold("Connection timed out, reconnecting..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            }
        } else if (connection === 'connecting') {
            console.log(chalk.blue.bold("Connecting to WhatsApp..."));
        } else if (connection === 'open') {
            console.log(chalk.green.bold("Bot successfully connected."));
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            if (!chatUpdate.messages) return;
            const msg = chatUpdate.messages[0];
            if (!msg.message) return;
            
            const m = await serialize(msg, sock, store);
            if (!m) return;
            
            if (m.isBot) return;
            
            // Handle stored messages
            await handleStoredMessage(m, sock, db);
            
            // Handle commands
            await handleCommand(m, sock, db);
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    sock.ev.on('messages.update', async (chatUpdate) => {
        for (const { key, update } of chatUpdate) {
            if (update.pollUpdates && key.fromMe) {
                const pollCreation = await sock.getMessage(key);
                if (pollCreation) {
                    const pollUpdate = await getAggregateVotesInPollMessage({
                        message: pollCreation.message,
                        pollUpdates: update.pollUpdates,
                    });
                    const toCmd = pollUpdate.filter((v) => v.voters.length !== 0)[0]?.name;
                    if (toCmd) {
                        const m = await serialize(pollCreation, sock, store);
                        await m.emit(toCmd);
                        await sock.sendMessage(key.remoteJid, { delete: key });
                    }
                }
            }
        }
    });

    return sock;
}

export function getStoredSessions() {
    const sessionsPath = 'sessions';
    if (!fs.existsSync(sessionsPath)) {
        fs.mkdirSync(sessionsPath, { recursive: true });
        return [];
    }
    
    return fs.readdirSync(sessionsPath)
        .filter(file => fs.statSync(`${sessionsPath}/${file}`).isDirectory());
}

export function deleteSession(phoneNumber) {
    const sessionPath = `sessions/${phoneNumber}`;
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        return true;
    }
    return false;
}