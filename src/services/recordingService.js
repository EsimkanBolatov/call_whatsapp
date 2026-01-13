const fs = require("fs");
const path = require("path");

class RecordingService {
  constructor() {
    this.recordingsDir = path.join(__dirname, "../../recordings");
    this.conversationsDir = path.join(__dirname, "../../conversations");
    this.sessions = new Map();

    // Ensure directories exist
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }
    if (!fs.existsSync(this.conversationsDir)) {
      fs.mkdirSync(this.conversationsDir, { recursive: true });
    }
  }

  /**
   * Start a new recording session
   * @param {string} sessionId - Unique session identifier
   * @param {object} callerInfo - Caller metadata (IP, device, location)
   * @returns {object} Session info
   */
  startSession(sessionId, callerInfo = null) {
    const session = {
      id: sessionId,
      startTime: new Date().toISOString(),
      callerInfo: callerInfo, // IP, device, geolocation
      messages: [],
      audioChunks: [],
      incidentData: null, // CAD data will be stored here
    };
    this.sessions.set(sessionId, session);
    console.log(`Recording session started: ${sessionId}`);
    return session;
  }

  /**
   * Add audio chunk to session
   * @param {string} sessionId
   * @param {Buffer} chunk - Audio data
   * @param {string} speaker - 'user' or 'ai'
   */
  addAudioChunk(sessionId, chunk, speaker) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.audioChunks.push({
        timestamp: new Date().toISOString(),
        speaker,
        data: chunk,
      });
    }
  }

  /**
   * Add message to conversation transcript
   * @param {string} sessionId
   * @param {string} speaker - 'user' or 'ai'
   * @param {string} text - Message text
   */
  addMessage(sessionId, speaker, text) {
    const session = this.sessions.get(sessionId);
    if (session) {
      const now = new Date();
      const startTime = new Date(session.startTime);
      const elapsedSeconds = Math.round((now - startTime) / 1000);

      // Format elapsed time as MM:SS
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      const elapsedFormatted = `${String(minutes).padStart(2, "0")}:${String(
        seconds
      ).padStart(2, "0")}`;

      session.messages.push({
        timestamp: now.toISOString(),
        timeFormatted: now.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        elapsed: elapsedFormatted, // Time since call started (MM:SS)
        speaker,
        speakerLabel: speaker === "user" ? "Заявитель" : "Диспетчер",
        text,
      });
    }
  }

  /**
   * Update incident/CAD data for session
   * @param {string} sessionId
   * @param {object} incidentData - CAD data from AI analysis
   */
  updateIncidentData(sessionId, incidentData) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.incidentData = incidentData;
    }
  }

  /**
   * End session and save all data
   * @param {string} sessionId
   * @returns {object} Saved file paths
   */
  async endSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`Session not found: ${sessionId}`);
      return null;
    }

    session.endTime = new Date().toISOString();

    // Calculate duration
    const start = new Date(session.startTime);
    const end = new Date(session.endTime);
    session.durationSeconds = Math.round((end - start) / 1000);

    // Save conversation transcript as JSON (including CAD data)
    const transcriptPath = path.join(
      this.conversationsDir,
      `${sessionId}.json`
    );

    // Format duration as MM:SS or HH:MM:SS
    const hours = Math.floor(session.durationSeconds / 3600);
    const mins = Math.floor((session.durationSeconds % 3600) / 60);
    const secs = session.durationSeconds % 60;
    const durationFormatted =
      hours > 0
        ? `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(
            2,
            "0"
          )}`
        : `${mins}:${String(secs).padStart(2, "0")}`;

    const startDate = new Date(session.startTime);
    const endDate = new Date(session.endTime);

    const transcript = {
      sessionId: session.id,
      // ISO timestamps
      startTime: session.startTime,
      endTime: session.endTime,
      // Human-readable formats
      dateFormatted: startDate.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      startTimeFormatted: startDate.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      endTimeFormatted: endDate.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      durationSeconds: session.durationSeconds,
      durationFormatted: durationFormatted, // e.g., "2:35" or "1:02:15"
      // Caller info (IP, device, location)
      callerInfo: session.callerInfo,
      // CAD data
      incidentData: session.incidentData,
      // All messages with timestamps
      messageCount: session.messages.length,
      messages: session.messages,
    };
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));

    // Save combined audio if there are chunks
    let audioPath = null;
    if (session.audioChunks.length > 0) {
      // Save user audio (WAV format)
      const userChunks = session.audioChunks
        .filter((c) => c.speaker === "user")
        .map((c) => c.data);

      if (userChunks.length > 0) {
        audioPath = path.join(this.recordingsDir, `${sessionId}_user.wav`);
        const combinedAudio = Buffer.concat(userChunks);
        fs.writeFileSync(audioPath, combinedAudio);
        console.log(
          `  User audio saved: ${audioPath} (${combinedAudio.length} bytes)`
        );
      }

      // Save AI audio (MP3 format)
      const aiChunks = session.audioChunks
        .filter((c) => c.speaker === "ai")
        .map((c) => c.data);

      if (aiChunks.length > 0) {
        const aiAudioPath = path.join(
          this.recordingsDir,
          `${sessionId}_ai.mp3`
        );
        const combinedAiAudio = Buffer.concat(aiChunks);
        fs.writeFileSync(aiAudioPath, combinedAiAudio);
        console.log(
          `  AI audio saved: ${aiAudioPath} (${combinedAiAudio.length} bytes)`
        );
      }
    }

    // Clean up session from memory
    this.sessions.delete(sessionId);

    console.log(`Session saved: ${sessionId}`);
    console.log(`  Transcript: ${transcriptPath}`);
    if (audioPath) {
      console.log(`  Audio: ${audioPath}`);
    }

    return {
      transcriptPath,
      audioPath,
      duration: session.durationSeconds,
      messageCount: session.messages.length,
    };
  }

  /**
   * Get all saved conversations
   * @returns {Array} List of conversation summaries
   */
  getConversations() {
    const files = fs.readdirSync(this.conversationsDir);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const content = fs.readFileSync(
          path.join(this.conversationsDir, f),
          "utf8"
        );
        const data = JSON.parse(content);
        return {
          sessionId: data.sessionId,
          startTime: data.startTime,
          duration: data.durationSeconds,
          messageCount: data.messages.length,
          incidentData: data.incidentData,
        };
      });
  }

  /**
   * Get specific conversation
   * @param {string} sessionId
   * @returns {object|null} Conversation data
   */
  getConversation(sessionId) {
    const filePath = path.join(this.conversationsDir, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content);
    }
    return null;
  }
}

module.exports = RecordingService;
