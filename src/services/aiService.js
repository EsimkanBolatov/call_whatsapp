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
            content: `Роль: Интеллектуальный аналитик и помощник диспетчера экстренных служб (Co-Pilot)

Ты — невидимый интеллектуальный помощник диспетчера экстренных служб полиции.
Ты НЕ заменяешь оператора, не принимаешь юридически значимых решений.
Твоя задача — анализировать входящие данные, формировать подсказки оператору, автоматически заполнять карточку происшествия.

ОСНОВНЫЕ ФУНКЦИИ:

1. АНАЛИЗ РАЗГОВОРА:
- Кратко резюмируй суть обращения (1–2 предложения)
- Определи: тип происшествия, срочность, угрозу жизни
- Выдели: адрес, количество участников, оружие, приметы

2. ДЕТЕКЦИЯ ЭМОЦИЙ:
- Определяй: паника, агрессия, шок, спокойствие
- При повышении риска — помечай как КРИТИЧЕСКИЙ

3. КЛАССИФИКАЦИЯ (Smart-Triage):
Категории: Убийство, Грабеж, ДТП, Бытовой конфликт, Мошенничество, Справочный
Приоритет: 🔴 Критический | 🟠 Высокий | 🟡 Средний | 🟢 Низкий

4. АВТОЗАПОЛНЕНИЕ КАРТОЧКИ (CAD):
Адрес | Тип | Описание | Участники | Подозреваемый | Транспорт | Оружие | Пострадавшие

ФОРМАТ ОТВЕТА (кратко, структурировано):
📋 Резюме: [суть за 1-2 предложения]
🚨 Категория: [тип] | Приоритет: [🔴/🟠/🟡/🟢]
😰 Эмоции: [состояние заявителя]
📍 Данные: [адрес, приметы, важные факты]
💡 Рекомендация: [что уточнить / действие]

ПРИНЦИПЫ:
- Отвечай КРАТКО (будет озвучено)
- Официальный служебный язык
- Никогда не перегружай информацией
- Приоритет: сохранение жизни → скорость → точность`,
          },
        ]);
      }

      const history = this.conversationHistory.get(sessionId);
      history.push({ role: "user", content: userMessage });

      const completion = await this.openai.chat.completions.create({
        model: process.env.AI_MODEL || "gpt-4o-mini",
        messages: history,
        max_tokens: 300, // Increased for structured response
        temperature: 0.3, // Lower for more consistent responses
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
   * Analyze incident from caller's speech
   * @param {string} text - Caller's speech text
   * @returns {Promise<object>} Incident analysis
   */
  async analyzeIncident(text) {
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Ты анализатор экстренных вызовов. Проанализируй текст заявителя и верни ТОЛЬКО JSON:

{
  "priority": "critical|high|medium|low",
  "priorityEmoji": "🔴|🟠|🟡|🟢",
  "category": "убийство|грабеж|дтп|бытовой_конфликт|мошенничество|справочный|другое",
  "categoryRu": "название на русском",
  "emotion": "паника|агрессия|шок|страх|спокойствие",
  "emotionEmoji": "😱|😡|😨|😰|😐",
  "threatLevel": "высокая|средняя|низкая|нет",
  "address": "адрес если упомянут или null",
  "weapons": "описание оружия или null",
  "victims": "число пострадавших или null",
  "suspects": "описание подозреваемых или null",
  "vehicles": "описание ТС или null",
  "needsClarification": ["что нужно уточнить"]
}

Если данных нет - ставь null. Всегда возвращай валидный JSON.`,
          },
          { role: "user", content: text },
        ],
        max_tokens: 300,
        temperature: 0.2,
      });

      const responseText = completion.choices[0].message.content.trim();

      // Parse JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error("JSON parse error:", e);
        }
      }

      return {
        priority: "medium",
        priorityEmoji: "🟡",
        category: "другое",
        categoryRu: "Другое",
        emotion: "спокойствие",
        emotionEmoji: "😐",
        threatLevel: "нет",
        address: null,
        weapons: null,
        victims: null,
        suspects: null,
        vehicles: null,
        needsClarification: ["Уточните суть обращения"],
      };
    } catch (error) {
      console.error("Incident analysis error:", error);
      return {
        priority: "medium",
        priorityEmoji: "🟡",
        category: "другое",
        categoryRu: "Другое",
        emotion: "спокойствие",
        emotionEmoji: "😐",
        threatLevel: "нет",
        address: null,
        weapons: null,
        victims: null,
        suspects: null,
        vehicles: null,
        needsClarification: [],
      };
    }
  }

  /**
   * Full pipeline: Audio -> Text -> Incident Analysis -> AI Response -> Audio
   * @param {Buffer} audioBuffer - Input audio
   * @param {string} sessionId - Session ID
   * @returns {Promise<{text: string, response: string, audio: Buffer, incident: object}>}
   */
  async processAudio(audioBuffer, sessionId) {
    const userText = await this.speechToText(audioBuffer, sessionId);
    console.log(`[${sessionId}] Заявитель: ${userText}`);

    // Analyze incident in parallel with generating response
    const [incident, aiResponse] = await Promise.all([
      this.analyzeIncident(userText),
      this.generateResponse(userText, sessionId),
    ]);

    console.log(
      `[${sessionId}] Инцидент: ${incident.priorityEmoji} ${incident.categoryRu} | Эмоция: ${incident.emotionEmoji} ${incident.emotion}`
    );
    console.log(`[${sessionId}] Рекомендация: ${aiResponse}`);

    const responseAudio = await this.textToSpeech(aiResponse);

    return {
      text: userText,
      response: aiResponse,
      audio: responseAudio,
      incident: incident,
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
