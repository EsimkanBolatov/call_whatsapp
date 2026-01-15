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

// Папки для хранения
const RECORDINGS_DIR = path.join(__dirname, "../recordings");
const CONVERSATIONS_DIR = path.join(__dirname, "../conversations");
const TEMP_DIR = path.join(__dirname, "../temp");

[RECORDINGS_DIR, CONVERSATIONS_DIR, TEMP_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Статика
app.use(express.static(path.join(__dirname, "client")));
// ВАЖНО: Открываем доступ к записям для админки
app.use("/recordings", express.static(RECORDINGS_DIR));

// API для админки: Получение списка звонков
app.get("/api/conversations", (req, res) => {
  try {
    const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
    const conversations = files.map(file => {
      const data = JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, file)));
      return data;
    });
    // Сортировка: новые сверху
    conversations.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    res.json(conversations);
  } catch (error) {
    console.error("Error reading conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  let currentSessionId = null;
  let sessionStartTime = null;
  let sessionTranscript = [];

  socket.on("call-ai", ({ deviceInfo }) => {
    currentSessionId = require("crypto").randomUUID();
    sessionStartTime = new Date();
    sessionTranscript = [];
    
    console.log(`AI Call Started: ${currentSessionId}`);
    socket.emit("ai-call-started", { sessionId: currentSessionId });
  });

  socket.on("audio-chunk", async ({ audioData, sessionId }) => {
    if (!sessionId || sessionId !== currentSessionId) return;

    try {
      console.log(`🔄 Processing audio for session: ${sessionId}`);
      const audioBuffer = Buffer.from(audioData, "base64");
      
      // Сохраняем аудио пользователя (добавляем timestamp, чтобы не перезаписывать)
      const userFilename = `${sessionId}_user_${Date.now()}.wav`;
      fs.writeFileSync(path.join(RECORDINGS_DIR, userFilename), audioBuffer);

      // Обработка ИИ
      const result = await aiService.processAudio(audioBuffer, sessionId);

      // Сохраняем аудио ответа ИИ
      const aiFilename = `${sessionId}_ai_${Date.now()}.mp3`;
      fs.writeFileSync(path.join(RECORDINGS_DIR, aiFilename), result.audio);

      // Добавляем в транскрипт сессии
      sessionTranscript.push({
        role: "user",
        text: result.text,
        audioUrl: `/recordings/${userFilename}`, // Ссылка для админки
        timestamp: new Date()
      });
      sessionTranscript.push({
        role: "ai",
        text: result.response,
        audioUrl: `/recordings/${aiFilename}`, // Ссылка для админки
        timestamp: new Date()
      });

      // Обновляем JSON файл сессии в реальном времени
      saveSessionData(sessionId, sessionStartTime, sessionTranscript, result.incident);

      // Отправляем ответ клиенту
      socket.emit("ai-response", {
        text: result.text,
        response: result.response,
        audio: result.audio.toString("base64"),
        incident: result.incident,
        shouldEndSession: result.shouldEndSession // Флаг завершения
      });

    } catch (error) {
      console.error("Processing error:", error);
      socket.emit("ai-error", { message: "Error processing audio" });
    }
  });

  socket.on("end-ai-call", ({ sessionId }) => {
    console.log(`Call Ended: ${sessionId}`);
    socket.emit("ai-call-ended");
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

function saveSessionData(sessionId, startTime, transcript, incident) {
  const data = {
    sessionId,
    startTime,
    endTime: new Date(),
    incident: incident || {},
    transcript: transcript
  };
  fs.writeFileSync(
    path.join(CONVERSATIONS_DIR, `${sessionId}.json`),
    JSON.stringify(data, null, 2)
  );
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});