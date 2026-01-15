require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const AIService = require("./services/aiService");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const aiService = new AIService();

// --- НАСТРОЙКА ПАПОК ---
const RECORDINGS_DIR = path.join(__dirname, "../recordings");
const CONVERSATIONS_DIR = path.join(__dirname, "../conversations");
const TEMP_DIR = path.join(__dirname, "../temp");

// Создаем папки, если их нет
[RECORDINGS_DIR, CONVERSATIONS_DIR, TEMP_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- СТАТИКА И API ---
app.use(express.static(path.join(__dirname, "client")));

// ВАЖНО: Открываем доступ к папке с записями по URL /recordings
app.use("/recordings", express.static(RECORDINGS_DIR));

// API: Получение списка всех звонков для админки
app.get("/api/conversations", (req, res) => {
  try {
    // Читаем все JSON файлы из папки conversations
    const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
    
    const conversations = files.map(file => {
      try {
        const filePath = path.join(CONVERSATIONS_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return data;
      } catch (err) {
        console.error(`Error reading file ${file}:`, err);
        return null;
      }
    }).filter(item => item !== null); // Убираем битые файлы

    // Сортируем: самые новые сверху
    conversations.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    
    res.json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// --- SOCKET.IO ЛОГИКА ---
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Переменные сессии
  let currentSessionId = null;
  let sessionStartTime = null;
  let sessionTranscript = []; 

  // 1. Начало звонка
  socket.on("call-ai", ({ deviceInfo }) => {
    currentSessionId = require("crypto").randomUUID();
    sessionStartTime = new Date();
    sessionTranscript = []; // Очищаем историю для новой сессии
    
    console.log(`AI Call Started: ${currentSessionId}`);
    
    // Создаем начальный файл сессии
    saveSessionData(currentSessionId, sessionStartTime, sessionTranscript, {});

    socket.emit("ai-call-started", { sessionId: currentSessionId });
  });

  // 2. Получение аудио от клиента
  socket.on("audio-chunk", async ({ audioData, sessionId }) => {
    // Проверка безопасности: обрабатываем только текущую сессию
    if (!sessionId || sessionId !== currentSessionId) return;

    try {
      console.log(`🔄 Processing audio for session: ${sessionId}`);
      const audioBuffer = Buffer.from(audioData, "base64");
      
      // А. Сохраняем аудио пользователя (WAV)
      const timestamp = Date.now();
      const userFilename = `${sessionId}_user_${timestamp}.wav`;
      const userFilePath = path.join(RECORDINGS_DIR, userFilename);
      fs.writeFileSync(userFilePath, audioBuffer);

      // Б. Обработка через AI Service
      // processAudio теперь возвращает flag shouldEndSession
      const result = await aiService.processAudio(audioBuffer, sessionId);

      // В. Сохраняем аудио ответа ИИ (MP3)
      const aiFilename = `${sessionId}_ai_${timestamp}.mp3`;
      const aiFilePath = path.join(RECORDINGS_DIR, aiFilename);
      fs.writeFileSync(aiFilePath, result.audio);

      // Г. Обновляем транскрипт сессии (добавляем ссылки на файлы)
      sessionTranscript.push({
        role: "user",
        text: result.text,
        audioUrl: `/recordings/${userFilename}`, // URL для фронтенда
        timestamp: new Date()
      });

      sessionTranscript.push({
        role: "ai",
        text: result.response,
        audioUrl: `/recordings/${aiFilename}`, // URL для фронтенда
        timestamp: new Date()
      });

      // Д. Сохраняем обновленные данные в JSON
      saveSessionData(sessionId, sessionStartTime, sessionTranscript, result.incident);

      // Е. Отправляем ответ клиенту
      socket.emit("ai-response", {
        text: result.text,
        response: result.response,
        audio: result.audio.toString("base64"),
        incident: result.incident,
        shouldEndSession: result.shouldEndSession // Флаг завершения звонка
      });

    } catch (error) {
      console.error("Processing error:", error);
      socket.emit("ai-error", { message: "Error processing audio" });
    }
  });

  // 3. Завершение звонка пользователем
  socket.on("end-ai-call", ({ sessionId }) => {
    console.log(`Call Ended by user: ${sessionId}`);
    // Можно добавить метку, что звонок завершен нормально
    if (sessionId === currentSessionId) {
       aiService.clearHistory(sessionId); // Очистка памяти сервиса
    }
    socket.emit("ai-call-ended");
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function saveSessionData(sessionId, startTime, transcript, incident) {
  const data = {
    sessionId,
    startTime,
    lastUpdate: new Date(),
    incident: incident || {}, // Данные CAD (адрес, категория, приоритет)
    transcript: transcript    // История сообщений с ссылками на аудио
  };

  const filePath = path.join(CONVERSATIONS_DIR, `${sessionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});