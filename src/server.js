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
  maxHttpBufferSize: 10e6, // 10MB for audio chunks
});

// Initialize services
const aiService = new AIService();
const recordingService = new RecordingService();

// Serve static files
app.use(express.static(path.join(__dirname, "client")));
app.use(express.json());

// API Routes
app.get("/api/conversations", (req, res) => {
  const conversations = recordingService.getConversations();
  res.json(conversations);
});

app.get("/api/conversations/:id", (req, res) => {
  const conversation = recordingService.getConversation(req.params.id);
  if (conversation) {
    res.json(conversation);
  } else {
    res.status(404).json({ error: "Conversation not found" });
  }
});

// Track users and AI agent
const users = new Map();
const AI_AGENT_ID = "ai-assistant";

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  users.set(socket.id, { id: socket.id, type: "user" });

  // Send updated user list (including AI agent)
  const userList = [
    { id: AI_AGENT_ID, name: "🤖 AI Ассистент", type: "ai" },
    ...Array.from(users.values()).filter((u) => u.id !== socket.id),
  ];
  socket.emit("users", userList);

  // Broadcast to others
  socket.broadcast.emit("user-joined", { id: socket.id });

  // Handle call to AI
  socket.on("call-ai", async () => {
    const sessionId = uuidv4();
    socket.sessionId = sessionId;

    // Start recording session
    recordingService.startSession(sessionId);

    socket.emit("ai-call-started", { sessionId });
    console.log(`AI call started: ${sessionId}`);
  });

  // Handle audio from user
  socket.on("audio-chunk", async (data) => {
    const { audioData, sessionId } = data;

    if (!audioData || !sessionId) {
      socket.emit("ai-error", { error: "Missing audio data or session" });
      return;
    }

    try {
      // Convert base64 to buffer
      const audioBuffer = Buffer.from(audioData, "base64");

      // Save user audio
      recordingService.addAudioChunk(sessionId, audioBuffer, "user");

      // Process through AI pipeline
      socket.emit("ai-processing", { status: "Обрабатываю ваш голос..." });

      const result = await aiService.processAudio(audioBuffer, sessionId);

      // Save messages to transcript
      recordingService.addMessage(sessionId, "user", result.text);
      recordingService.addMessage(sessionId, "ai", result.response);

      // Send response audio back with incident analysis
      socket.emit("ai-response", {
        text: result.text,
        response: result.response,
        audio: result.audio.toString("base64"),
        incident: result.incident,
      });
    } catch (error) {
      console.error("Error processing audio:", error);
      socket.emit("ai-error", {
        error: "Ошибка обработки. Попробуйте снова.",
        details: error.message,
      });
    }
  });

  // End AI call
  socket.on("end-ai-call", async ({ sessionId }) => {
    if (sessionId) {
      const result = await recordingService.endSession(sessionId);
      aiService.clearHistory(sessionId);

      socket.emit("ai-call-ended", {
        sessionId,
        duration: result?.duration || 0,
        messageCount: result?.messageCount || 0,
      });

      console.log(`AI call ended: ${sessionId}`);
    }
  });

  // P2P calling between users (existing functionality)
  socket.on("call-user", ({ to, offer }) => {
    io.to(to).emit("incoming-call", {
      from: socket.id,
      offer,
    });
  });

  socket.on("answer-call", ({ to, answer }) => {
    io.to(to).emit("call-accepted", {
      from: socket.id,
      answer,
    });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate,
    });
  });

  socket.on("end-call", ({ to }) => {
    io.to(to).emit("end-call", {
      from: socket.id,
    });
  });

  socket.on("disconnect", () => {
    users.delete(socket.id);
    io.emit("user-left", { id: socket.id });
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Recordings will be saved to ./recordings`);
  console.log(`💬 Transcripts will be saved to ./conversations`);
});
