require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const AIService = require("./services/aiService");

// --- КОНФИГУРАЦИЯ ERDR (Project 2) ---
const ERDR_API_URL = "http://127.0.0.1:8000"; // Адрес Python сервера

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const aiService = new AIService();

// --- НАСТРОЙКА ПАПОК ---
const RECORDINGS_DIR = path.join(__dirname, "../recordings");
const CONVERSATIONS_DIR = path.join(__dirname, "../conversations");
const TEMP_DIR = path.join(__dirname, "../temp");

[RECORDINGS_DIR, CONVERSATIONS_DIR, TEMP_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(path.join(__dirname, "client")));
app.use("/recordings", express.static(RECORDINGS_DIR));
app.use(express.json()); // Для парсинга JSON body

// --- API ROUTES ---

// 1. Получение списка звонков
app.get("/api/conversations", (req, res) => {
  try {
    const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
    const conversations = files.map(file => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, file), 'utf-8'));
      } catch (e) { return null; }
    }).filter(i => i !== null).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// 2. [НОВОЕ] Отправка данных в ЕРДР
app.post("/api/erdr/send/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    console.log(`[ERDR] Starting export for session ${sessionId}...`);

    try {
        // 1. Загружаем данные сессии
        const jsonPath = path.join(CONVERSATIONS_DIR, `${sessionId}.json`);
        if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: "Session not found" });
        
        const sessionData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        const incident = sessionData.incident || {};

        // 2. Находим аудиофайл пользователя (для простоты берем user wav или заглушку)
        // В идеале нужно склеить аудио, но пока берем последний файл пользователя
        const userAudioFiles = fs.readdirSync(RECORDINGS_DIR).filter(f => f.startsWith(`${sessionId}_user`));
        let audioFilename = null;
        
        // ШАГ 1: Загрузка Аудио в ERDR
        if (userAudioFiles.length > 0) {
            const lastAudio = userAudioFiles[userAudioFiles.length - 1]; // Берем последний кусок
            const audioPath = path.join(RECORDINGS_DIR, lastAudio);
            const fileStats = fs.statSync(audioPath);
            const fileBuffer = fs.readFileSync(audioPath);
            
            // Формируем Multipart запрос вручную (так как нет form-data библиотеки в зависимостях)
            // Но в Node 18+ есть глобальный fetch и FormData
            const formData = new FormData();
            const blob = new Blob([fileBuffer], { type: 'audio/wav' });
            formData.append('file', blob, lastAudio);

            console.log(`[ERDR] Uploading audio: ${lastAudio}`);
            
            try {
                const uploadRes = await fetch(`${ERDR_API_URL}/api/external/upload_audio`, {
                    method: 'POST',
                    body: formData
                });
                
                if (uploadRes.ok) {
                    const uploadData = await uploadRes.json();
                    audioFilename = uploadData.filename; // Получаем имя, которое сохранил сервер ERDR
                    console.log(`[ERDR] Audio saved as: ${audioFilename}`);
                } else {
                    console.error("[ERDR] Audio upload failed:", await uploadRes.text());
                }
            } catch (err) {
                console.error("[ERDR] Audio upload network error:", err.message);
            }
        }

        // ШАГ 2: Подготовка JSON для ERDR
        // Генерируем уникальный KUI (15 цифр)
        const generateKui = () => {
            const prefix = "2631"; // Код региона
            const random = Math.floor(Math.random() * 100000000000).toString().padStart(11, '0');
            return prefix + random;
        };

        // Форматирование даты в "DD.MM.YYYY HH:MM"
        const formatDate = (isoStr) => {
            if (!isoStr) return "";
            const d = new Date(isoStr);
            const pad = (n) => n.toString().padStart(2, '0');
            return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };

        const now = new Date();
        const confDate = new Date(now.getTime() + 15 * 60000); // +15 минут

        const erdrPayload = {
            // Обязательные поля (Вкладка 1)
            kui_number: generateKui(),
            reg_organ: "19310003", // Дефолт (УП района)
            district: incident.erdr_district || "Заводской район",
            reg_date: formatDate(sessionData.startTime),
            operator_conf_date: formatDate(confDate.toISOString()),
            event_description: incident.erdr_event_description || incident.event_description || `Обращение от ${incident.callerName || 'неизвестного'} (авто-генерация)`,
            
            // Доп поля
            military_unit: incident.military_unit || "",
            coupon_number: "",
            coupon_date: "",
            
            // Классификаторы
            field_5_1: incident.field_5_1 || "прочие",
            field_5_2: "",
            field_5_3: "Нет",
            field_5_4: "Нет",
            field_5_5: "Нет",
            field_5_6: incident.field_5_6 || "Нет", // Интернет-мошенничество
            field_5_7: "Нет",
            
            audio_record: audioFilename, // Имя файла из Шага 1

            // Вкладка 2 (ЦОУ)
            msg_type: "08 Сообщение ЦОУ",
            confidentiality: "не конфиденциально, не секретно",
            cou_name: "ЦОУ NG911 AI",
            cou_reg_number: `AI-${sessionId.substring(0,8).toUpperCase()}`,
            cou_reg_date: formatDate(sessionData.startTime),
            cou_position: "AI-Оператор",
            cou_employee: "Bot System v1.0",
            
            // Контакты
            city_phone: "",
            mobile_phone: sessionData.callerInfo?.phone || "Не определен",
            email: ""
        };

        console.log(`[ERDR] Sending JSON payload to ${ERDR_API_URL}...`);
        
        // ШАГ 3: Отправка JSON
        const sendRes = await fetch(`${ERDR_API_URL}/api/external/receive_data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(erdrPayload)
        });

        if (sendRes.ok) {
            const result = await sendRes.json();
            console.log(`[ERDR] Success! ID: ${result.id}`);
            return res.json({ success: true, erdrId: result.id, kui: erdrPayload.kui_number });
        } else {
            const errorText = await sendRes.text();
            console.error(`[ERDR] Failed: ${errorText}`);
            return res.status(502).json({ error: "ERDR API Error", details: errorText });
        }

    } catch (error) {
        console.error("[ERDR] Server Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- SOCKET.IO ЛОГИКА (Остается прежней) ---
io.on("connection", (socket) => {
  // ... Вставьте код сокет-логики из старого файла без изменений
  // Он нужен для работы звонка, но здесь мы его не меняем
  let currentSessionId = null;
  let sessionStartTime = null;
  let sessionTranscript = []; 

  socket.on("call-ai", ({ deviceInfo }) => {
    currentSessionId = require("crypto").randomUUID();
    sessionStartTime = new Date();
    sessionTranscript = [];
    const filePath = path.join(CONVERSATIONS_DIR, `${currentSessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ sessionId: currentSessionId, startTime: sessionStartTime, incident: {}, transcript: [] }, null, 2));
    socket.emit("ai-call-started", { sessionId: currentSessionId });
  });

  socket.on("audio-chunk", async ({ audioData, sessionId }) => {
     try {
        const audioBuffer = Buffer.from(audioData, "base64");
        const userFile = path.join(RECORDINGS_DIR, `${sessionId}_user_${Date.now()}.wav`);
        fs.writeFileSync(userFile, audioBuffer);
        
        const result = await aiService.processAudio(audioBuffer, sessionId);
        
        const aiFile = path.join(RECORDINGS_DIR, `${sessionId}_ai_${Date.now()}.mp3`);
        fs.writeFileSync(aiFile, result.audio);

        sessionTranscript.push({ role: 'user', text: result.text });
        sessionTranscript.push({ role: 'ai', text: result.response });

        // Сохранение данных
        const data = {
            sessionId,
            startTime: sessionStartTime,
            incident: result.incident, // ВАЖНО: сюда попадают новые поля для ЕРДР из aiService
            transcript: sessionTranscript
        };
        fs.writeFileSync(path.join(CONVERSATIONS_DIR, `${sessionId}.json`), JSON.stringify(data, null, 2));

        socket.emit("ai-response", {
            text: result.text, response: result.response, audio: result.audio.toString("base64"), incident: result.incident
        });
     } catch(e) { console.error(e); }
  });
  
  socket.on("end-ai-call", ({ sessionId }) => {
     aiService.clearHistory(sessionId);
     socket.emit("ai-call-ended");
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});