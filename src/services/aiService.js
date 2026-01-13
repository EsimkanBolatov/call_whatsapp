const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

class AIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.conversationHistory = new Map(); // For analyst (CAD)
    this.dispatcherHistory = new Map(); // For dispatcher (voice)
    this.incidentData = new Map(); // Accumulated CAD data per session
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
   * Generate dispatcher response (voice) - talks like a real 911 operator
   * @param {string} userMessage - Caller's message
   * @param {string} sessionId - Session identifier
   * @param {object} incidentContext - Current incident data for context
   * @returns {Promise<string>} Dispatcher response text
   */
  async generateDispatcherResponse(
    userMessage,
    sessionId,
    incidentContext = null
  ) {
    try {
      // Get or initialize dispatcher history
      if (!this.dispatcherHistory.has(sessionId)) {
        this.dispatcherHistory.set(sessionId, [
          {
            role: "system",
            content: `Ты — диспетчер экстренных служб 102 (полиция).
Твоя задача — профессионально общаться с заявителем.

ПРИНЦИПЫ:
1.  **ПРИОРИТЕТ ЖИЗНИ**: Если угроза жизни, оружие или насилие — СРАЗУ отправляй наряд. Не задавай лишних вопросов.
2.  **АДАПТИВНОСТЬ**:
    *   **CRITICAL / HIGH** (Убийство, нападение, ДТП с жертвами):
        - Спрашивай ТОЛЬКО: "ГДЕ?" и "ЕСТЬ ЛИ ОРУЖИЕ/УГРОЗА?"
        - Сразу говори: "Наряд выехал. Оставайтесь на линии."
        - НЕ спрашивай подробности или ФИО, пока помощь не направлена.
    *   **MEDIUM / LOW** (Шум, кража, справочная):
        - Действуй по протоколу: Что случилось? Где? Кто звонит? Детали.
        - Будь вежлив, но краток.

3.  **СТИЛЬ ОБЩЕНИЯ**:
    - Говори КРАТКО (макс. 2 предложения).
    - Успокаивай паникеров ("Помощь уже едет, я с вами").
    - Четкие команды ("Говорите адрес", "Отойдите в безопасное место").

НЕ ДЕЛАЙ: не зачитывай резюме, не говори сложно, не молчи.`,
          },
        ]);
      }

      const history = this.dispatcherHistory.get(sessionId);

      // Add context about what we already know AND the analysis context
      let contextMessage = userMessage;

      // Determine urgency context from incident data
      let urgencyContext = "";
      if (incidentContext) {
        if (
          incidentContext.priority === "critical" ||
          incidentContext.priority === "high"
        ) {
          urgencyContext = `[СИТУАЦИЯ КРИТИЧЕСКАЯ! ПРИОРИТЕТ: ${incidentContext.priority.toUpperCase()}! ЭМОЦИИ: ${
            incidentContext.emotion
          }. СОКРАТИ ВОПРОСЫ! НУЖЕН ТОЛЬКО АДРЕС И УГРОЗА!]`;
        } else {
          urgencyContext = `[Ситуация штатная. Приоритет: ${
            incidentContext.priority || "обычный"
          }.]`;
        }

        const known = [];
        if (incidentContext.address)
          known.push(`АДРЕС ЕСТЬ: ${incidentContext.address}`);
        else known.push("АДРЕСА НЕТ (спроси срочно!)");

        if (incidentContext.category)
          known.push(`тип: ${incidentContext.categoryRu}`);
        if (incidentContext.weapons)
          known.push(`оружие: ${incidentContext.weapons}`);

        contextMessage = `${urgencyContext}\n[Известно: ${known.join(
          ", "
        )}]\n\nЗаявитель: ${userMessage}`;
      }

      history.push({ role: "user", content: contextMessage });

      const completion = await this.openai.chat.completions.create({
        model: process.env.AI_MODEL || "gpt-4o-mini",
        messages: history,
        max_tokens: 100, // Very short for quick voice response
        temperature: 0.5,
      });

      const response = completion.choices[0].message.content;
      history.push({ role: "assistant", content: response });

      // Keep only last 20 messages
      if (history.length > 22) {
        const systemMessage = history[0];
        this.dispatcherHistory.set(sessionId, [
          systemMessage,
          ...history.slice(-20),
        ]);
      }

      return response;
    } catch (error) {
      console.error("Dispatcher response error:", error);
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
  "category": "убийство|грабеж|дтп|бытовой_конфликт|мошенничество|справочный|пожар|здоровье|другое",
  "categoryRu": "название на русском",
  "dispatchTo": "police|ambulance|mchs|gas|district|info",
  "dispatchToRu": "Полиция|Скорая|МЧС|Газ|Участковый|Справочная",
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

Логика распределения служб (dispatchTo):
- Насилие, оружие, криминал, ДТП без жертв -> police
- Ранение, болезнь, ДТП с жертвами -> ambulance
- Пожар, задымление, спасение -> mchs
- Запах газа, взрыв -> gas
- Шум, соседи, семейные соры (без оружия) -> district
- Вопросы, консультация -> info

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
   * Merge new incident data with accumulated data
   * @param {string} sessionId
   * @param {object} newData - New incident analysis
   * @returns {object} Merged incident data
   */
  mergeIncidentData(sessionId, newData) {
    let accumulated = this.incidentData.get(sessionId) || {};

    // Merge - newer non-null values override
    const merged = { ...accumulated };

    for (const [key, value] of Object.entries(newData)) {
      if (value !== null && value !== undefined) {
        // For needsClarification, accumulate unique items
        if (key === "needsClarification" && Array.isArray(value)) {
          merged[key] = [...new Set([...(accumulated[key] || []), ...value])];
        }
        // For priority, keep the highest
        else if (key === "priority") {
          const priorities = { critical: 4, high: 3, medium: 2, low: 1 };
          if (
            !accumulated[key] ||
            priorities[value] > priorities[accumulated[key]]
          ) {
            merged[key] = value;
            merged.priorityEmoji = newData.priorityEmoji;
          }
        } else {
          merged[key] = value;
        }
      }
    }

    this.incidentData.set(sessionId, merged);
    return merged;
  }

  /**
   * Full pipeline: Audio -> Text -> [Analyst + Dispatcher in parallel] -> Audio
   * Analyst: Updates CAD silently
   * Dispatcher: Responds with voice
   * @param {Buffer} audioBuffer - Input audio
   * @param {string} sessionId - Session ID
   * @returns {Promise<{text: string, response: string, audio: Buffer, incident: object}>}
   */
  async processAudio(audioBuffer, sessionId) {
    const userText = await this.speechToText(audioBuffer, sessionId);
    console.log(`[${sessionId}] 📞 Заявитель: ${userText}`);

    // Get current accumulated incident data for context
    const currentIncident = this.incidentData.get(sessionId) || {};

    // Run BOTH AIs in parallel:
    // 1. Analyst - analyzes and updates CAD (silent)
    // 2. Dispatcher - talks to caller (voice)
    const [incidentAnalysis, dispatcherResponse] = await Promise.all([
      this.analyzeIncident(userText),
      this.generateDispatcherResponse(userText, sessionId, currentIncident),
    ]);

    // Merge new analysis with accumulated CAD data
    const mergedIncident = this.mergeIncidentData(sessionId, incidentAnalysis);

    console.log(
      `[${sessionId}] 📋 CAD: ${mergedIncident.priorityEmoji || "🟡"} ${
        mergedIncident.categoryRu || "Не определено"
      } | 😰 ${mergedIncident.emotion || "спокойствие"}`
    );
    console.log(`[${sessionId}] 🎙️ Диспетчер: ${dispatcherResponse}`);

    // TTS only for dispatcher response (not the analysis!)
    const responseAudio = await this.textToSpeech(dispatcherResponse);

    return {
      text: userText,
      response: dispatcherResponse, // This is what gets spoken
      audio: responseAudio,
      incident: mergedIncident, // Accumulated CAD data
    };
  }

  /**
   * Get accumulated incident data for a session
   * @param {string} sessionId
   * @returns {object} Accumulated incident data
   */
  getIncidentData(sessionId) {
    return this.incidentData.get(sessionId) || {};
  }

  /**
   * Clear all history for a session
   * @param {string} sessionId
   */
  clearHistory(sessionId) {
    this.conversationHistory.delete(sessionId);
    this.dispatcherHistory.delete(sessionId);
    this.incidentData.delete(sessionId);
  }
}

module.exports = AIService;
