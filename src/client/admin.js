document.addEventListener("DOMContentLoaded", () => {
  // Элементы DOM
  const conversationList = document.getElementById("conversationList");
  const searchInput = document.getElementById("searchInput");
  const emptyState = document.getElementById("emptyState");
  const conversationDetail = document.getElementById("conversationDetail");
  const refreshBtn = document.getElementById("refreshBtn");
  const saveErdrBtn = document.getElementById("saveErdrBtn");

  // Состояние
  let conversations = [];
  let selectedId = null;
  let currentFilter = "all";

  // Маппинг категорий для фильтров
  const DEPARTMENT_MAP = {
    police: ["убийство", "грабеж", "мошенничество", "хулиганство", "кража"],
    ambulance: ["здоровье", "травма"],
    mchs: ["пожар", "спасение"],
    info: ["справочный", "другое", null],
  };

  // Инициализация
  fetchConversations();

  // Обработчики событий
  searchInput.addEventListener("input", applyFilters);

  refreshBtn.addEventListener("click", () => {
    fetchConversations();
    if (selectedId) loadConversation(selectedId);
  });

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      currentFilter = e.target.getAttribute("data-filter");
      applyFilters();
    });
  });

  // Логика кнопки сохранения в ЕРДР
  saveErdrBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    
    const originalText = saveErdrBtn.innerHTML;
    saveErdrBtn.innerHTML = "⏳ Отправка (Аудио+JSON)...";
    saveErdrBtn.disabled = true;

    try {
        // Вызываем НАШ сервер Node.js, который сам свяжется с Python ERDR
        const response = await fetch(`/api/erdr/send/${selectedId}`, {
            method: 'POST'
        });

        const result = await response.json();

        if (response.ok) {
            alert(`✅ УСПЕХ!\nКУИ: ${result.kui}\nID в базе ЕРДР: ${result.erdrId}`);
            saveErdrBtn.innerHTML = "✅ Сохранено в ЕРДР";
            saveErdrBtn.style.backgroundColor = "var(--success)";
        } else {
            throw new Error(result.details || result.error || "Ошибка сервера");
        }
    } catch (error) {
        console.error("ERDR Send error:", error);
        alert(`❌ ОШИБКА ОТПРАВКИ:\n${error.message}`);
        saveErdrBtn.innerHTML = "❌ Ошибка";
        saveErdrBtn.style.backgroundColor = "var(--danger)";
    }

    // Возврат кнопки в исходное состояние
    setTimeout(() => {
        if (!saveErdrBtn.innerHTML.includes("✅")) {
             saveErdrBtn.innerHTML = originalText;
             saveErdrBtn.style.backgroundColor = "";
        }
        saveErdrBtn.disabled = false;
    }, 4000);
  });

  // --- Функции ---

  async function fetchConversations() {
    try {
      const response = await fetch("/api/conversations");
      if (!response.ok) throw new Error("Failed to fetch");

      const data = await response.json();
      // Сортировка: новые сверху
      conversations = data
        .map((c) => ({ ...c, date: new Date(c.startTime) }))
        .sort((a, b) => b.date - a.date);

      applyFilters();
    } catch (error) {
      console.error("Error:", error);
      conversationList.innerHTML = '<div class="loading" style="color:var(--danger)">Ошибка загрузки</div>';
    }
  }

  function renderList(items) {
    conversationList.innerHTML = "";

    if (items.length === 0) {
      conversationList.innerHTML = '<div class="loading">Нет данных</div>';
      return;
    }

    items.forEach((conv) => {
      const el = document.createElement("div");
      el.className = `conversation-item ${selectedId === conv.sessionId ? "active" : ""}`;
      el.onclick = () => selectConversation(conv.sessionId);

      const timeStr = conv.date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      const emoji = conv.incidentData?.priorityEmoji || "⚪";
      const category = conv.incidentData?.categoryRu || "Не определено";

      el.innerHTML = `
        <div class="conv-header">
            <span class="conv-id">${emoji} ${timeStr}</span>
            <span class="conv-time">${conv.messageCount} msg</span>
        </div>
        <div class="conv-preview" style="color:white; font-weight:500;">
            ${category}
        </div>
        <div class="conv-preview" style="font-size:0.75rem; margin-top:4px;">
            ID: ${conv.sessionId.substring(0, 8)}...
        </div>
      `;
      conversationList.appendChild(el);
    });
  }

  function applyFilters() {
    const term = searchInput.value.toLowerCase();
    const filtered = conversations.filter((c) => {
      const matchesSearch = c.sessionId.toLowerCase().includes(term);
      let matchesDept = true;
      if (currentFilter !== "all") {
        const cat = c.incidentData?.category || null;
        const allowed = DEPARTMENT_MAP[currentFilter] || [];
        matchesDept = allowed.includes(cat);
      }
      return matchesSearch && matchesDept;
    });
    renderList(filtered);
  }

  function selectConversation(id) {
    selectedId = id;
    
    // Обновляем активный класс в списке
    document.querySelectorAll(".conversation-item").forEach(el => el.classList.remove("active"));
    const activeItem = [...conversationList.children].find(el => el.innerHTML.includes(id.substring(0,8)));
    if(activeItem) activeItem.classList.add("active");

    emptyState.classList.add("hidden");
    conversationDetail.classList.remove("hidden");
    loadConversation(id);
  }

  async function loadConversation(id) {
    // В данном примере данные уже могут быть в `conversations`, но для полноты делаем запрос если нужно
    // Используем найденный объект из памяти для скорости
    const data = conversations.find(c => c.sessionId === id);
    if(data) renderDetail(data);
  }

  function renderDetail(data) {
    // Хедер
    document.getElementById("detailSessionId").textContent = data.sessionId;
    document.getElementById("detailDate").textContent = data.dateFormatted;
    document.getElementById("detailTime").textContent = `${data.startTimeFormatted} - ${data.endTimeFormatted || '...'}`;
    document.getElementById("detailDuration").textContent = data.durationFormatted || "0:00";

    // Чат
    const chatContainer = document.getElementById("chatContainer");
    chatContainer.innerHTML = "";
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach((msg) => {
        const div = document.createElement("div");
        div.className = `message ${msg.speaker}`;
        div.innerHTML = `
            <div class="msg-header">
                <span>${msg.speakerLabel}</span>
                <span>${msg.elapsed || ""}</span>
            </div>
            <div>${msg.text}</div>
        `;
        chatContainer.appendChild(div);
      });
    } else {
        chatContainer.innerHTML = '<p style="text-align:center; opacity:0.5;">Нет сообщений</p>';
    }

    // Инцидент
    const inc = data.incidentData || {};
    const priorityEl = document.getElementById("incidentPriority");
    priorityEl.textContent = `${inc.priorityEmoji || ''} ${inc.priority ? inc.priority.toUpperCase() : '-'}`;
    priorityEl.style.color = inc.priority === 'critical' ? 'var(--danger)' : (inc.priority === 'high' ? 'var(--warning)' : 'inherit');
    
    document.getElementById("incidentService").textContent = inc.dispatchToRu || '-';
    document.getElementById("incidentType").textContent = inc.categoryRu || '-';
    document.getElementById("incidentEmotion").textContent = `${inc.emotion || '-'} ${inc.emotionEmoji || ''}`;
    
    document.getElementById("incidentDataContent").textContent = JSON.stringify(inc, null, 2);

    // Абонент
    const info = data.callerInfo || {};
    document.getElementById("callerIp").textContent = info.ip || "-";
    document.getElementById("callerDevice").textContent = info.deviceInfo ? info.deviceInfo.os : "-";
    
    let locStr = "-";
    if(info.location && info.location.latitude) {
        locStr = `${info.location.latitude.toFixed(4)}, ${info.location.longitude.toFixed(4)}`;
    }
    document.getElementById("callerLocation").textContent = locStr;

    // Аудио плееры
    const userAudio = document.getElementById("userAudioInfo");
    const aiAudio = document.getElementById("aiAudioInfo");
    const noUser = document.getElementById("noUserAudio");
    const noAi = document.getElementById("noAiAudio");

    // Формируем пути к файлам. Сервер раздает статику из папки recordings по пути /recordings
    userAudio.src = `/recordings/${data.sessionId}_user.wav`;
    aiAudio.src = `/recordings/${data.sessionId}_ai.mp3`;

    // Обработка ошибок загрузки аудио
    userAudio.onloadeddata = () => { userAudio.classList.remove("hidden"); noUser.classList.add("hidden"); };
    userAudio.onerror = () => { userAudio.classList.add("hidden"); noUser.classList.remove("hidden"); };

    aiAudio.onloadeddata = () => { aiAudio.classList.remove("hidden"); noAi.classList.add("hidden"); };
    aiAudio.onerror = () => { aiAudio.classList.add("hidden"); noAi.classList.remove("hidden"); };
  }
});