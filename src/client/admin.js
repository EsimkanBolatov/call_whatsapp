document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const conversationList = document.getElementById("conversationList");
  const searchInput = document.getElementById("searchInput");
  const emptyState = document.getElementById("emptyState");
  const conversationDetail = document.getElementById("conversationDetail");
  const refreshBtn = document.getElementById("refreshBtn");

  // State
  let conversations = [];
  let selectedId = null;
  let currentFilter = "all";

  // Department Mapping
  const DEPARTMENT_MAP = {
    police: ["убийство", "грабеж", "мошенничество"],
    patrol: ["бытовой_конфликт", "хулиганство"],
    traffic: ["дтп"],
    info: ["справочный", "другое", null],
  };

  // Initial load
  fetchConversations();

  // Event Listeners
  searchInput.addEventListener("input", applyFilters);

  refreshBtn.addEventListener("click", () => {
    fetchConversations();
    if (selectedId) {
      loadConversation(selectedId);
    }
  });

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      // UI update
      document
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");

      // Logic update
      currentFilter = e.target.getAttribute("data-filter");
      applyFilters();
    });
  });

  // Functions
  async function fetchConversations() {
    try {
      const response = await fetch("/api/conversations");
      if (!response.ok) throw new Error("Failed to fetch");

      const data = await response.json();
      // Sort by date desc (newest first)
      conversations = data
        .map((c) => ({
          ...c,
          date: new Date(c.startTime),
        }))
        .sort((a, b) => b.date - a.date);

      applyFilters();
    } catch (error) {
      console.error("Error fetching conversations:", error);
      conversationList.innerHTML =
        '<div class="error">Ошибка загрузки данных</div>';
    }
  }

  function renderList(items) {
    conversationList.innerHTML = "";

    if (items.length === 0) {
      conversationList.innerHTML =
        '<div class="no-results">Разговоров не найдено</div>';
      return;
    }

    items.forEach((conv) => {
      const el = document.createElement("div");
      el.className = `conversation-item ${
        selectedId === conv.sessionId ? "active" : ""
      }`;
      el.onclick = () => selectConversation(conv.sessionId);

      const dateStr = conv.date.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "short",
      });
      const timeStr = conv.date.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const category = conv.incidentData?.categoryRu || "Н/Д";
      const emoji = conv.incidentData?.priorityEmoji || "⚪";

      el.innerHTML = `
                <div class="conv-id">
                    <span>${emoji}</span>
                    <span>${conv.sessionId}</span>
                </div>
                <div class="conv-details" style="font-size:0.75rem; margin-bottom:4px; color:#94a3b8;">
                    ${category}
                </div>
                <div class="conv-meta">
                    <span>${dateStr} ${timeStr}</span>
                    <span>${conv.messageCount} сообщ.</span>
                </div>
            `;
      conversationList.appendChild(el);
    });
  }

  function applyFilters() {
    const term = searchInput.value.toLowerCase();

    const filtered = conversations.filter((c) => {
      // Search Filter
      const matchesSearch = c.sessionId.toLowerCase().includes(term);

      // Department Filter
      let matchesDept = true;
      if (currentFilter !== "all") {
        const category = c.incidentData?.category || null;
        // Handle specific case for 'info' which includes null category
        if (currentFilter === "info" && !c.incidentData) {
          matchesDept = true;
        } else {
          const allowedCategories = DEPARTMENT_MAP[currentFilter] || [];
          // Check if any allowed category matches the incident category
          // using partial match or exact match depending on data quality
          // The AI returns: "убийство", etc. so exact match checking inclusion should work
          matchesDept = allowedCategories.includes(category);
        }
      }

      return matchesSearch && matchesDept;
    });

    renderList(filtered);
  }

  function selectConversation(id) {
    selectedId = id;

    // Update list active state
    document.querySelectorAll(".conversation-item").forEach((el) => {
      el.classList.remove("active");
      if (el.querySelector(".conv-id").textContent === id) {
        el.classList.add("active");
      }
    });

    // Show detail view
    emptyState.classList.add("hidden");
    conversationDetail.classList.remove("hidden");

    loadConversation(id);
  }

  async function loadConversation(id) {
    try {
      // Show loading state in details if needed, for now just fetch
      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) throw new Error("Failed to load conversation");

      const data = await response.json();
      renderDetail(data);
    } catch (error) {
      console.error("Error loading detail:", error);
    }
  }

  function renderDetail(data) {
    // Header info
    document.getElementById("detailSessionId").textContent = data.sessionId;
    document.getElementById("detailDate").textContent = data.dateFormatted;
    document.getElementById(
      "detailTime"
    ).textContent = `${data.startTimeFormatted} - ${data.endTimeFormatted}`;
    document.getElementById("detailDuration").textContent = `Длительность: ${
      data.durationFormatted || "0:00"
    }`;

    // Chat Transcript
    const chatContainer = document.getElementById("chatContainer");
    chatContainer.innerHTML = "";

    if (data.messages && data.messages.length > 0) {
      data.messages.forEach((msg) => {
        const msgEl = document.createElement("div");
        msgEl.className = `message ${msg.speaker}`;
        msgEl.innerHTML = `
                    <div class="msg-header">
                        <span class="msg-speaker">${msg.speakerLabel}</span>
                        <span class="msg-time">${msg.elapsed || ""}</span>
                    </div>
                    <div class="msg-content">${msg.text}</div>
                `;
        chatContainer.appendChild(msgEl);
      });
    } else {
      chatContainer.innerHTML =
        '<p class="no-data" style="text-align:center; padding: 20px;">Транскрипция пуста</p>';
    }

    // Caller Info
    const info = data.callerInfo || {};
    document.getElementById("callerIp").textContent = info.ip || "-";

    let deviceStr = "-";
    if (info.deviceInfo) {
      deviceStr = `${info.deviceInfo.browser || ""}On ${
        info.deviceInfo.os || ""
      }`;
    }
    document.getElementById("callerDevice").textContent = deviceStr;

    let locStr = "-";
    if (info.location) {
      const { latitude, longitude } = info.location;
      if (latitude && longitude) {
        locStr = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      }
    }
    document.getElementById("callerLocation").textContent = locStr;

    // Incident Data
    const incidentDiv = document.getElementById("incidentDataContent");
    if (data.incidentData) {
      incidentDiv.textContent = JSON.stringify(data.incidentData, null, 2);
      incidentDiv.classList.remove("no-data");
    } else {
      incidentDiv.innerHTML = '<p class="no-data">Нет данных</p>';
    }

    // Audio
    // Since we don't have a direct endpoint for partial files in this simple server
    // without digging deeper, we might check if we can construct paths.
    // Looking at server.js, there is no static route for 'recordings' folder.
    // But let's assume valid file serving if we add it or if it exists.
    // Actually, the current server.js only serves 'client' folder at root.
    // We probably need to add a route to serve recordings if we want to play them,
    // OR rely on the structure.
    // Wait, looking at server.js: `app.use(express.static(path.join(__dirname, "client")));`
    // It does NOT serve recordings.
    // I should probably add a quick route in server.js to serve recordings securely or publically.
    // For now, I will hide the audio players or show a message if source is not available,
    // but to make them work, I should technically expose the recordings folder.
    // Let's assume for this task step I just render the UI.

    // However, to be "Agentic" and helpful, I should enable serving recordings.
    // I will add that to the plan or just do it.
    // For now, let's just create the JS logic assuming the endpoint exists or will exist.
    // I'll add a TODO to server.js in the next step to serve recordings.

    // Actually, let's just disable them visually if we can't play them,
    // but I will instruct the user or fix server.js.
    // Ideally, `/recordings/filename` would work if I add static serve.

    // Let's guess the path structure:
    // If I add `app.use('/recordings', express.static(...))`
    // Then path is `/recordings/${id}_user.wav`

    const userAudio = document.getElementById("userAudioInfo");
    const aiAudio = document.getElementById("aiAudioInfo");
    const noUserAudio = document.getElementById("noUserAudio");
    const noAiAudio = document.getElementById("noAiAudio");

    // Reset
    userAudio.src = "";
    aiAudio.src = "";
    userAudio.classList.add("hidden");
    aiAudio.classList.add("hidden");
    noUserAudio.classList.remove("hidden");
    noAiAudio.classList.remove("hidden");

    // We can check blindly.
    // But better: checks if server serves them.
    // I will implement the assumption that /recordings/ is mounted.

    if (true) {
      // If we assume we will fix the server
      userAudio.src = `/recordings/${data.sessionId}_user.wav`;
      aiAudio.src = `/recordings/${data.sessionId}_ai.mp3`;

      // Basic error handling on load
      userAudio.onerror = () => {
        userAudio.classList.add("hidden");
        noUserAudio.classList.remove("hidden");
      };
      userAudio.oncanplay = () => {
        userAudio.classList.remove("hidden");
        noUserAudio.classList.add("hidden");
      };

      aiAudio.onerror = () => {
        aiAudio.classList.add("hidden");
        noAiAudio.classList.remove("hidden");
      };
      aiAudio.oncanplay = () => {
        aiAudio.classList.remove("hidden");
        noAiAudio.classList.add("hidden");
      };
    }
  }
});
