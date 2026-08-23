const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const https = require('https');

// 1. سيرفر ويب فوري لمنصة Railway لضمان عدم إيقاف الحاوية
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Bot is running successfully!</h2>`);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// 2. دالة إرسال التنبيه عبر CallMeBot
function sendCallMeBotAlert(messageText) {
    const phone = "249114662437";
    const apiKey = "5816385";
    const encodedMessage = encodeURIComponent(messageText);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMessage}&apikey=${apiKey}`;

    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            console.log('CallMeBot response:', data);
        });
    }).on("error", (err) => {
        console.error("API Error:", err.message);
    });
}

const messageStore = new Map();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_railway_v3');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Chrome'),
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    let codeRequested = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        // طلب الرمز بطريقة آمنة وسريعة بدون إيقاف الحاوية
        if (!sock.authState.creds.registered && !codeRequested) {
            codeRequested = true;
            const phoneNumber = "249114662437"; 
            
            // انتظار قصير جداً 5 ثوانٍ فقط لضمان فتح الـ WebSocket بأمان
            setTimeout(async () => {
                try {
                    console.log('🔄 جاري طلب رمز الربط...');
                    let code = await sock.requestPairingCode(phoneNumber);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    
                    console.log(`\n========================================`);
                    console.log(`🔐 رمز الربط الخاص بك هو: ${code}`);
                    console.log(`========================================\n`);
                } catch (error) {
                    console.error("فشل في طلب رمز الربط:", error);
                    codeRequested = false;
                }
            }, 5000);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('🎉 تم تسجيل الدخول بنجاح!');
            sendCallMeBotAlert("🚀 تم ربط بوت مراقبة الرسائل بنجاح!");
        }
    });

    // تخزين الرسائل
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        const messageId = msg.key.id;
        const chatJid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        
        if (text) {
            messageStore.set(messageId, { 
                chatJid, 
                sender: msg.key.participant || chatJid, 
                text 
            });
        }
    });

    // رصد الرسائل المحذوفة
    sock.ev.on('message.delete', async (item) => {
        const deletedId = item.keys[0].id;
        const cachedMsg = messageStore.get(deletedId);
        
        if (cachedMsg) {
            const alertText = `⚠️ تنبيه حذف رسالة!\nمن: ${cachedMsg.sender}\nالنص المحذوف: ${cachedMsg.text}`;
            sendCallMeBotAlert(alertText);
        }
    });
}

startBot();
