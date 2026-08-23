const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const https = require('https');

// 1. سيرفر ويب بسيط للبقاء نشيطاً على Railway
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

// 2. دالة إرسال التنبيه عبر الـ API
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

// 3. تشغيل بوت مراقبة واتساب
const messageStore = new Map();

async function startBot() {
    // استخدمنا مجلد جلسة جديد كلياً لتجنب أي بيانات قديمة
    const { state, saveCreds } = await useMultiFileAuthState('session_new_railway');
    
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

        if (!sock.authState.creds.registered && !codeRequested) {
            codeRequested = true;
            const phoneNumber = "249114662437"; 
            
            console.log('⏳ جاري الانتظار 30 ثانية لثبات الاتصال تماماً وتجنب الحظر...');
            // انتظار 30 ثانية كاملة لضمان استقرار السيرفر الجديد
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            try {
                console.log('🔄 جاري طلب رمز الربط الآن...');
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                console.log(`\n========================================`);
                console.log(`🔐 رمز الربط الجديد الخاص بك هو: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("فشل في طلب رمز الربط:", error);
                codeRequested = false; // السماح بإعادة المحاولة إذا فشل
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

    // رصد الرسائل المحذوفة وإرسالها عبر CallMeBot
    sock.ev.on('message.delete', async (item) => {
        const deletedId = item.keys[0].id;
        const cachedMsg = messageStore.get(deletedId);
        
        if (cachedMsg) {
            const alertText = `⚠️ تنبيه حذف رسالة!\nمن: ${cachedMsg.sender}\nالنص المحذوف: ${cachedMsg.text}`;
            console.log(alertText);
            sendCallMeBotAlert(alertText);
        }
    });
}

startBot();
