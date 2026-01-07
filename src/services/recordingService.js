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
   * @returns {object} Session info
   */
  startSession(sessionId) {
    const session = {
      id: sessionId,
      startTime: new Date().toISOString(),
      messages: [],
      audioChunks: [],
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
      session.messages.push({
        timestamp: new Date().toISOString(),
        speaker,
        text,
      });
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

    // Save conversation transcript as JSON
    const transcriptPath = path.join(
      this.conversationsDir,
      `${sessionId}.json`
    );
    const transcript = {
      sessionId: session.id,
      startTime: session.startTime,
      endTime: session.endTime,
      durationSeconds: session.durationSeconds,
      messages: session.messages,
    };
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));

    // Save combined audio if there are chunks
    let audioPath = null;
    if (session.audioChunks.length > 0) {
      // Combine user audio chunks only for the recording
      const userChunks = session.audioChunks
        .filter((c) => c.speaker === "user")
        .map((c) => c.data);

      if (userChunks.length > 0) {
        audioPath = path.join(this.recordingsDir, `${sessionId}_user.webm`);
        const combinedAudio = Buffer.concat(userChunks);
        fs.writeFileSync(audioPath, combinedAudio);
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
