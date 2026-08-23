const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function startBot() {
    // استخدام مجلد جديد كلياً
    const { state, saveCreds } = await useMultiFileAuthState('session_logs_v6');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Chrome'),
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // الانتظار حتى يستقر الاتصال تماماً قبل طلب الرمز لتجنب توقف السيرفر
        if ((qr || connection === 'connecting') && !sock.authState.creds.registered) {
            const phoneNumber = "249114662437"; 
            
            try {
                // زيادة وقت الانتظار إلى 8 ثوانٍ لضمان ثبات الاتصال بسيرفرات واتساب
                await new Promise(resolve => setTimeout(resolve, 8000));
                
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                console.log(`\n========================================`);
                console.log(`🔐 رمز الربط الجديد هو: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("خطأ في طلب الرمز:", error);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('🎉 تم تسجيل الدخول بنجاح والبوت يعمل الآن!');
        }
    });

    const messageStore = new Map();
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text) {
            messageStore.set(msg.key.id, { chatJid: msg.key.remoteJid, sender: msg.key.participant || msg.key.remoteJid, text });
        }
    });

    sock.ev.on('message.delete', async (item) => {
        const cachedMsg = messageStore.get(item.keys[0].id);
        if (cachedMsg) {
            const alertText = `⚠️ *تنبيه حذف رسالة!*\n👤 *من:* ${cachedMsg.sender}\n💬 *النص المحذوف:* ${cachedMsg.text}`;
            await sock.sendMessage('249114662437@s.whatsapp.net', { text: alertText });
        }
    });
}

startBot();
