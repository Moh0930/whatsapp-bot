const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const https = require('https');

// 1. سيرفر ويب بسيط لضمان بقاء التطبيق نشيطاً على Railway
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
            <h2 style="color: #25D366;">بوت مراقبة وحذف الرسائل يعمل بنجاح!</h2>
            <p>جاهز لإرسال التنبيهات عبر CallMeBot API.</p>
        </div>
    `);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// 2. دالة إرسال التنبيه عبر الـ API الذي نجح معك
function sendCallMeBotAlert(messageText) {
    const phone = "249114662437";
    const apiKey = "5816385";
    const encodedMessage = encodeURIComponent(messageText);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMessage}&apikey=${apiKey}`;

    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            console.log('تم إرسال تنبيه الحذف بنجاح عبر CallMeBot:', data);
        });
    }).on("error", (err) => {
        console.error("خطأ في إرسال الـ API:", err.message);
    });
}

// 3. تشغيل بوت مراقبة واتساب (Baileys)
const messageStore = new Map();

async function startBot() {
    // استخدمنا مجلد جلسة جديد ونظيف
    const { state, saveCreds } = await useMultiFileAuthState('session_final_api');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // سيظهر الـ QR في السجلات (Logs) لمن يحتاجه، أو نعتمد على كود الربط
        browser: Browsers.macOS('Chrome'),
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    let codeRequested = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // طلب كود الرقم تلقائياً بكل سهولة
        if (!sock.authState.creds.registered && !codeRequested) {
            codeRequested = true;
            const phoneNumber = "249114662437"; 
            
            await new Promise(resolve => setTimeout(resolve, 6000));
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(`🔐 رمز الربط الخاص بك هو: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("فشل في طلب رمز الربط:", error);
                codeRequested = false;
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('🎉 تم تسجيل الدخول بنجاح والبوت مراقب للرسائل!');
            sendCallMeBotAlert("🚀 تم ربط بوت مراقبة الرسائل بنجاح وجاهز للعمل!");
        }
    });

    // تخزين الرسائل الواردة
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

    // رصد الرسائل المحذوفة وإرسالها عبر CallMeBot فوراً
    sock.ev.on('message.delete', async (item) => {
        const deletedId = item.keys[0].id;
        const cachedMsg = messageStore.get(deletedId);
        
        if (cachedMsg) {
            const alertText = `⚠️ تنبيه حذف رسالة!\nمن: ${cachedMsg.sender}\nالنص المحذوف: ${cachedMsg.text}`;
            console.log(alertText);
            // إرسال التنبيه فوراً عبر الـ API
            sendCallMeBotAlert(alertText);
        }
    });
}

startBot();
