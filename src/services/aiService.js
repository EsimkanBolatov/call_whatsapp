const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

class AIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.conversationHistory = new Map(); // История для аналитика (CAD)
    this.dispatcherHistory = new Map(); // История для диспетчера (голос)
    this.incidentData = new Map(); // Накопленные данные CAD по сессиям
  }

  /**
   * Конвертация аудио в текст с помощью OpenAI Whisper
   * @param {Buffer} audioBuffer - Аудио данные (WAV)
   * @param {string} sessionId - ID сессии
   * @returns {Promise<string>} Текст транскрипции
   */
  async speechToText(audioBuffer, sessionId) {
    console.log(`[DEBUG] Starting speechToText for session ${sessionId}`);
    // Генерируем уникальное имя файла, чтобы избежать конфликтов
    const uniqueId = `${sessionId}_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const tempPath = path.join(__dirname, `../../temp/${uniqueId}.wav`);

    try {
      // Убедимся, что папка temp существует
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
      console.log(
        `[DEBUG] Transcription complete: ${transcription.text.substring(
          0,
          50
        )}...`
      );

      // Безопасное удаление временного файла
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (unlinkError) {
        console.warn(`Could not delete temp file: ${tempPath}`);
      }

      return transcription.text;
    } catch (error) {
      // Очистка при ошибке
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (unlinkError) {
        // Игнорируем ошибки удаления
      }
      console.error("Speech-to-Text error:", error);
      throw error;
    }
  }

  /**
   * Генерация ответа ИИ (стандартный чат, редко используется в voice-режиме напрямую)
   */
  async generateResponse(userMessage, sessionId) {
    try {
      if (!this.conversationHistory.has(sessionId)) {
        this.conversationHistory.set(sessionId, [
          {
            role: "system",
            content: `Роль: Интеллектуальный аналитик и помощник диспетчера экстренных служб (Co-Pilot)
Ты — невидимый интеллектуальный помощник диспетчера экстренных служб полиции.
Ты НЕ заменяешь оператора, не принимаешь юридически значимых решений.
Твоя задача — анализировать входящие данные, формировать подсказки оператору, автоматически заполнять карточку происшествия.`,
          },
        ]);
      }

      const history = this.conversationHistory.get(sessionId);
      history.push({ role: "user", content: userMessage });

      const completion = await this.openai.chat.completions.create({
        model: process.env.AI_MODEL || "gpt-4o-mini",
        messages: history,
        max_tokens: 300,
        temperature: 0.3,
      });

      const aiResponse = completion.choices[0].message.content;
      history.push({ role: "assistant", content: aiResponse });

      // Ограничиваем историю
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
   * Генерация ответа диспетчера (голос)
   * @param {string} userMessage - Сообщение звонящего
   * @param {string} sessionId - ID сессии
   * @param {object} incidentContext - Текущие данные инцидента
   * @returns {Promise<string>} Текст ответа диспетчера
   */
  async generateDispatcherResponse(
    userMessage,
    sessionId,
    incidentContext = null
  ) {
    console.log(`[DEBUG] Generating dispatcher response`);
    try {
      if (!this.dispatcherHistory.has(sessionId)) {
        this.dispatcherHistory.set(sessionId, [
          {
            role: "system",
            content: `Ты — диспетчер экстренных служб 102 (полиция).
Твоя задача — профессионально общаться с заявителем.

ПРИНЦИПЫ:
1.  **ПРИОРИТЕТ ЖИЗНИ**: Если угроза жизни, оружие или насилие — СРАЗУ отправляй наряд. Не задавай лишних вопросов.
2.  **АДАПТИВНОСТЬ**:
    * **CRITICAL / HIGH** (Убийство, нападение, ДТП с жертвами):
        - Спрашивай ТОЛЬКО: "ГДЕ?" и "ЕСТЬ ЛИ ОРУЖИЕ/УГРОЗА?"
        - Сразу говори: "Наряд выехал. Оставайтесь на линии."
        - НЕ спрашивай подробности или ФИО, пока помощь не направлена.
    * **MEDIUM / LOW** (Шум, кража, справочная):
        - Действуй по протоколу: Что случилось? Где? Кто звонит? Детали.
        - Будь вежлив, но краток.

3.  **СТИЛЬ ОБЩЕНИЯ**:
    - Говори КРАТКО (макс. 2 предложения).
    - Успокаивай паникеров ("Помощь уже едет, я с вами").
    - Четкие команды ("Говорите адрес", "Отойдите в безопасное место").

4. **СБОР ДАННЫХ**:
    - Обязательно узнай **Имя и Фамилию** заявителя, если ситуация позволяет (нет прямой угрозы жизни).
    - Формат вопроса: "Назовите вашу фамилию и имя."

НЕ ДЕЛАЙ: не зачитывай резюме, не говори сложно, не молчи.`,
          },
        ]);
      }

      const history = this.dispatcherHistory.get(sessionId);

      // Добавляем контекст из того, что уже известно (CAD)
      let contextMessage = userMessage;
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
        max_tokens: 100, // Очень короткий ответ для скорости
        temperature: 0.5,
      });

      const response = completion.choices[0].message.content;
      history.push({ role: "assistant", content: response });

      // Ограничиваем историю 20 сообщениями
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
   * Конвертация текста в речь (OpenAI TTS)
   * @param {string} text - Текст
   * @returns {Promise<Buffer>} MP3 буфер
   */
  async textToSpeech(text) {
    console.log(
      `[DEBUG] Starting textToSpeech for: ${text.substring(0, 50)}...`
    );
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
   * Анализ инцидента (Smart-Triage & CAD)
   * ОБНОВЛЕНО ДЛЯ ИНТЕГРАЦИИ С ЕРДР (PROJECT 2)
   */
  async analyzeIncident(text) {
    console.log(
      `[DEBUG] Analyzing incident for text: ${text.substring(0, 50)}...`
    );
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Ты аналитик экстренных вызовов для полиции Казахстана.
Твоя задача — извлечь данные и вернуть ТОЛЬКО JSON для регистрации в ЕРДР (Единый реестр досудебных расследований).

Структура JSON:
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
  "address": "полный адрес происшествия или null",
  "callerName": "Фамилия Имя заявителя или null",
  "needsClarification": ["список вопросов"],

  // --- ПОЛЯ ДЛЯ ЕРДР ---
  "erdr_district": "Строго одно из: 'Заводской район', 'Алматинский район', 'ДП Жамбылской области'. Правила: Астана/Алматы -> Алматинский район. Тараз/Заводы -> Заводской район. Область/Трасса -> ДП Жамбылской области.",
  "erdr_event_description": "Сухая юридическая фабула (3-4 предложения). Пример: '15.01.2026 гр. Иванова сообщила о краже кошелька...'",
  "field_5_1": "Классификатор: 'против собственности', 'против личности', 'прочие', 'общественная безопасность'.",
  "field_5_6": "Интернет-мошенничество? Строго 'Да' или 'Нет'.",
  "military_unit": "Номер воинской части если есть (иначе пустая строка)"
}

Если данных нет - используй null или дефолтные значения ("Нет", "прочие"). Всегда возвращай валидный JSON.`,
          },
          { role: "user", content: text },
        ],
        max_tokens: 400,
        temperature: 0.1, // Низкая температура для точности данных
      });

      const responseText = completion.choices[0].message.content.trim();

      // Парсинг JSON
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error("JSON parse error:", e);
        }
      }

      // Fallback
      return {
        priority: "medium",
        categoryRu: "Не определено",
        dispatchToRu: "Инфо",
        needsClarification: [],
        erdr_district: "Заводской район",
        field_5_1: "прочие",
        field_5_6: "Нет",
        erdr_event_description: "Автоматическая регистрация (ошибка анализа)"
      };
    } catch (error) {
      console.error("Incident analysis error:", error);
      return {
        priority: "medium",
        categoryRu: "Ошибка",
        dispatchToRu: "Инфо",
        needsClarification: [],
        erdr_district: "Заводской район",
        field_5_1: "прочие",
        field_5_6: "Нет"
      };
    }
  }

  /**
   * Слияние новых данных инцидента с накопленными
   */
  mergeIncidentData(sessionId, newData) {
    let accumulated = this.incidentData.get(sessionId) || {};
    const merged = { ...accumulated };

    // Приоритеты служб (выше = важнее)
    const servicePriority = {
      police: 10,
      ambulance: 10,
      mchs: 10,
      gas: 10,
      district: 5,
      info: 1,
      other: 0,
      null: -1,
    };

    const priorities = { critical: 4, high: 3, medium: 2, low: 1 };

    for (const [key, value] of Object.entries(newData)) {
      if (value !== null && value !== undefined && value !== "") {
        // Объединяем списки уточнений
        if (key === "needsClarification" && Array.isArray(value)) {
          merged[key] = [...new Set([...(accumulated[key] || []), ...value])];
        }
        // Обновляем приоритет только на более высокий
        else if (key === "priority") {
          if (
            !accumulated[key] ||
            priorities[value] > priorities[accumulated[key]]
          ) {
            merged[key] = value;
            merged.priorityEmoji = newData.priorityEmoji;
          }
        }
        // Выбираем службу с наивысшим приоритетом
        else if (key === "dispatchTo") {
          const distinctOld = accumulated[key] || "null";
          const distinctNew = value || "null";
          const oldScore = servicePriority[distinctOld] || 0;
          const newScore = servicePriority[distinctNew] || 0;

          if (newScore >= oldScore) {
            merged[key] = value;
            if (newData.dispatchToRu)
              merged.dispatchToRu = newData.dispatchToRu;
          }
        }
        // Категорию "другое" или "справка" не ставим поверх уже определенной конкретики
        else if (key === "category") {
          const oldCat = accumulated[key];
          const isNewGeneric = ["другое", "справочный"].includes(value);

          if (!oldCat || !isNewGeneric) {
            merged[key] = value;
            if (newData.categoryRu) merged.categoryRu = newData.categoryRu;
          }
        }
        // Специальные поля для ЕРДР (просто перезаписываем, если есть значение)
        else if (["erdr_district", "erdr_event_description", "field_5_1", "field_5_6", "military_unit"].includes(key)) {
             merged[key] = value;
        }
        // Остальные поля просто обновляем
        else {
          merged[key] = value;
        }
      }
    }

    this.incidentData.set(sessionId, merged);
    return merged;
  }

  /**
   * Полный пайплайн: Аудио -> Текст -> [Анализ + Диспетчер параллельно] -> Аудио
   */
  async processAudio(audioBuffer, sessionId) {
    // 1. Распознавание речи (STT)
    const userText = await this.speechToText(audioBuffer, sessionId);
    console.log(`[${sessionId}] 📞 Заявитель: ${userText}`);

    // Получаем накопленный контекст
    const currentIncident = this.incidentData.get(sessionId) || {};

    // 2. Параллельный запуск Аналитика и Диспетчера
    const [incidentAnalysis, dispatcherResponse] = await Promise.all([
      this.analyzeIncident(userText),
      this.generateDispatcherResponse(userText, sessionId, currentIncident),
    ]);

    // 3. Обновление CAD данных
    const mergedIncident = this.mergeIncidentData(sessionId, incidentAnalysis);

    console.log(
      `[${sessionId}] 📋 CAD: ${mergedIncident.priorityEmoji || "🟡"} ${
        mergedIncident.categoryRu || "Не определено"
      } | ЕРДР Район: ${mergedIncident.erdr_district || "Н/Д"}`
    );
    console.log(`[${sessionId}] 🎙️ Диспетчер: ${dispatcherResponse}`);

    // 4. Генерация голоса (TTS) только для ответа диспетчера
    const responseAudio = await this.textToSpeech(dispatcherResponse);

    return {
      text: userText,
      response: dispatcherResponse, // Текст ответа
      audio: responseAudio, // Аудио буфер
      incident: mergedIncident, // Обновленные данные инцидента
    };
  }

  getIncidentData(sessionId) {
    return this.incidentData.get(sessionId) || {};
  }

  clearHistory(sessionId) {
    this.conversationHistory.delete(sessionId);
    this.dispatcherHistory.delete(sessionId);
    this.incidentData.delete(sessionId);
  }
}

module.exports = AIService;