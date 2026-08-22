const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http'); // مكتبة لفتح سيرفر ويب خفيف لـ Render

// 1. فتح سيرفر ويب وهمي حتى لا تغلق منصة Render الخدمة
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Deleted Messages Bot is running!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// تخزين مؤقت للرسائل الواردة
const messageStore = new Map();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('انقطع الاتصال، جاري إعادة المحاولة...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('تم تسجيل الدخول بنجاح والبوت يعمل الآن!');
        }
    });

    // 2. حفظ كل رسالة واردة في الذاكرة المؤقتة
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        
        const messageId = msg.key.id;
        const chatJid = msg.key.remoteJid;
        
        // استخراج نص الرسالة
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        
        if (text) {
            messageStore.set(messageId, {
                chatJid: chatJid,
                sender: msg.key.participant || chatJid,
                text: text
            });
        }
    });

    // 3. مراقبة حدث حذف الرسائل
    sock.ev.on('message.delete', async (item) => {
        const deletedId = item.keys[0].id;
        const cachedMsg = messageStore.get(deletedId);

        if (cachedMsg) {
            const alertText = `⚠️ *تنبيه حذف رسالة!*\n👤 *من:* ${cachedMsg.sender}\n💬 *النص المحذوف:* ${cachedMsg.text}`;
            
            // رقمك الخاص لاستقبال التنبيه
            const myJid = '249114662437@s.whatsapp.net';
            
            await sock.sendMessage(myJid, { text: alertText });
            console.log('تم إرسال تنبيه الحذف بنجاح!');
        }
    });
}

startBot();
