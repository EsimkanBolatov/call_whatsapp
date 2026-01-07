const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

class AIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.conversationHistory = new Map();
  }

  /**
   * Convert audio buffer to text using OpenAI Whisper
   * @param {Buffer} audioBuffer - Audio data in WAV format
   * @param {string} sessionId - Session identifier
   * @returns {Promise<string>} Transcribed text
   */
  async speechToText(audioBuffer, sessionId) {
    // Generate unique file name to avoid race conditions
    const uniqueId = `${sessionId}_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const tempPath = path.join(__dirname, `../../temp/${uniqueId}.wav`);

    try {
      // Ensure temp directory exists
      const tempDir = path.dirname(tempPath);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      fs.writeFileSync(tempPath, audioBuffer);

      console.log(
        `Audio file saved: ${tempPath}, size: ${audioBuffer.length} bytes`
      );

      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: "whisper-1",
        language: "ru",
      });

      // Clean up temp file safely
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (unlinkError) {
        console.warn(`Could not delete temp file: ${tempPath}`);
      }

      return transcription.text;
    } catch (error) {
      // Clean up on error too
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (unlinkError) {
        // Ignore cleanup errors
      }
      console.error("Speech-to-Text error:", error);
      throw error;
    }
  }

  /**
   * Generate AI response using GPT
   * @param {string} userMessage - User's message
   * @param {string} sessionId - Session identifier for conversation history
   * @returns {Promise<string>} AI response text
   */
  async generateResponse(userMessage, sessionId) {
    try {
      // Get or initialize conversation history
      if (!this.conversationHistory.has(sessionId)) {
        this.conversationHistory.set(sessionId, [
          {
            role: "system",
            content: `Ты - дружелюбный AI-ассистент для голосовых звонков. 
Отвечай кратко и по существу, так как твои ответы будут озвучены.
Используй простые предложения. Будь вежливым и полезным.
Если не знаешь ответ - честно скажи об этом.
Отвечай на языке пользователя (русский, казахский или английский).`,
          },
        ]);
      }

      const history = this.conversationHistory.get(sessionId);
      history.push({ role: "user", content: userMessage });

      const completion = await this.openai.chat.completions.create({
        model: process.env.AI_MODEL || "gpt-4o-mini",
        messages: history,
        max_tokens: 150,
        temperature: 0.7,
      });

      const aiResponse = completion.choices[0].message.content;
      history.push({ role: "assistant", content: aiResponse });

      // Keep only last 20 messages to manage context size
      if (history.length > 22) {
        const systemMessage = history[0];
        this.conversationHistory.set(sessionId, [
          systemMessage,
          ...history.slice(-20),
        ]);
      }

      return aiResponse;
    } catch (error) {
      console.error("Generate response error:", error);
      throw error;
    }
  }

  /**
   * Convert text to speech using OpenAI TTS
   * @param {string} text - Text to convert to speech
   * @returns {Promise<Buffer>} Audio buffer in mp3 format
   */
  async textToSpeech(text) {
    try {
      const mp3 = await this.openai.audio.speech.create({
        model: "tts-1",
        voice: process.env.TTS_VOICE || "alloy",
        input: text,
        response_format: "mp3",
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      return buffer;
    } catch (error) {
      console.error("Text-to-Speech error:", error);
      throw error;
    }
  }

  /**
   * Detect emotion from text
   * @param {string} text - Text to analyze
   * @returns {Promise<{emotion: string, emoji: string, confidence: number}>}
   */
  async detectEmotion(text) {
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Analyze the emotion in the given text. Respond ONLY with a JSON object in this exact format:
{"emotion": "название эмоции на русском", "emoji": "один подходящий эмодзи", "confidence": число от 0 до 1}

Emotions to detect: радость, грусть, злость, страх, удивление, отвращение, нейтральность, любовь, интерес, скука, волнение, благодарность, смущение, гордость`,
          },
          { role: "user", content: text },
        ],
        max_tokens: 50,
        temperature: 0.3,
      });

      const responseText = completion.choices[0].message.content.trim();

      // Parse JSON response
      const jsonMatch = responseText.match(/\{[^}]+\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return { emotion: "нейтральность", emoji: "😐", confidence: 0.5 };
    } catch (error) {
      console.error("Emotion detection error:", error);
      return { emotion: "нейтральность", emoji: "😐", confidence: 0 };
    }
  }

  /**
   * Full pipeline: Audio -> Text -> Emotion -> AI Response -> Audio
   * @param {Buffer} audioBuffer - Input audio
   * @param {string} sessionId - Session ID
   * @returns {Promise<{text: string, response: string, audio: Buffer, emotion: object}>}
   */
  async processAudio(audioBuffer, sessionId) {
    const userText = await this.speechToText(audioBuffer, sessionId);
    console.log(`[${sessionId}] User said: ${userText}`);

    // Detect emotion in parallel with generating response
    const [emotion, aiResponse] = await Promise.all([
      this.detectEmotion(userText),
      this.generateResponse(userText, sessionId),
    ]);

    console.log(
      `[${sessionId}] Emotion: ${emotion.emoji} ${
        emotion.emotion
      } (${Math.round(emotion.confidence * 100)}%)`
    );
    console.log(`[${sessionId}] AI response: ${aiResponse}`);

    const responseAudio = await this.textToSpeech(aiResponse);

    return {
      text: userText,
      response: aiResponse,
      audio: responseAudio,
      emotion: emotion,
    };
  }

  /**
   * Clear conversation history for a session
   * @param {string} sessionId
   */
  clearHistory(sessionId) {
    this.conversationHistory.delete(sessionId);
  }
}

module.exports = AIService;
