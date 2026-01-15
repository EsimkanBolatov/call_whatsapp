require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const AIService = require("./services/aiService");
const RecordingService = require("./services/recordingService");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
  maxHttpBufferSize: 1e8, // Увеличил лимит до 100MB для надежности
  pingTimeout: 60000, // Увеличил таймаут
});

const aiService = new AIService();
const recordingService = new RecordingService();

// Static files
app.use(express.static(path.join(__dirname, "client")));
app.use("/recordings", express.static(path.join(__dirname, "../recordings")));
app.use(express.json());

// Routes
app.get("/api/conversations", (req, res) => {
  res.json(recordingService.getConversations());
});

app.get("/api/conversations/:id", (req, res) => {
  const conversation = recordingService.getConversation(req.params.id);
  conversation ? res.json(conversation) : res.status(404).send("Not found");
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("call-ai", async (data = {}) => {
    const sessionId = uuidv4();
    socket.sessionId = sessionId;
    
    // Start session logic...
    recordingService.startSession(sessionId, {
        ip: socket.handshake.address,
        deviceInfo: data.deviceInfo
    });

    socket.emit("ai-call-started", { sessionId });
    console.log(`AI Call Started: ${sessionId}`);
  });

  socket.on("audio-chunk", async (data) => {
    console.log(`📨 Received audio-chunk event for session: ${data?.sessionId}`);
    
    // ВАЖНО: Деструктурируем именно audioData
    const { audioData, sessionId } = data;

    if (!audioData) {
      console.error("❌ ERROR: Received audio-chunk but audioData is MISSING or empty!");
      socket.emit("ai-error", { error: "No audio data received" });
      return;
    }

    if (!sessionId) {
      console.error("❌ ERROR: Received audio-chunk but sessionId is MISSING!");
      return;
    }

    try {
      console.log(`🔄 Processing audio data size: ${audioData.length} bytes`);

      // Decode Base64 to Buffer
      const audioBuffer = Buffer.from(audioData, "base64");
      console.log(`📁 Converted to Buffer: ${audioBuffer.length} bytes`);

      // Save chunk
      recordingService.addAudioChunk(sessionId, audioBuffer, "user");

      socket.emit("ai-processing", { status: "Обработка..." });

      // Process AI
      const result = await aiService.processAudio(audioBuffer, sessionId);

      // Save messages and incident
      recordingService.addMessage(sessionId, "user", result.text);
      recordingService.addMessage(sessionId, "ai", result.response);
      recordingService.addAudioChunk(sessionId, result.audio, "ai");
      recordingService.updateIncidentData(sessionId, result.incident);

      // Respond
      socket.emit("ai-response", {
        text: result.text,
        response: result.response,
        audio: result.audio.toString("base64"), // Send back as Base64
        incident: result.incident,
      });
      console.log(`✅ AI Response sent for session: ${sessionId}`);

    } catch (error) {
      console.error("❌ Processing error in server:", error);
      socket.emit("ai-error", { error: "Processing failed", details: error.message });
    }
  });

  socket.on("end-ai-call", async ({ sessionId }) => {
    if (sessionId) {
      const res = await recordingService.endSession(sessionId);
      aiService.clearHistory(sessionId);
      socket.emit("ai-call-ended", { duration: res?.duration || 0, messageCount: res?.messageCount || 0 });
      console.log(`Call Ended: ${sessionId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});