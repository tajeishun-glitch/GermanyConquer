const EMOJIS = ["👍", "🔥", "🚀", "💡", "✅"];

let portalState = {
  teamName: "//CodeBreaker",
  timer: { mode: "warmup", label: "Pre-Hackathon Warmup", endsAt: null },
  members: [],
  channels: [],
  files: [],
  messages: [],
  ideas: [],
  tasks: [],
  presence: { onlineMemberIds: [], connectedTabs: 0 },
  serverInfo: {
    port: 8000,
    lanUrls: [],
    aiConfigured: false,
    aiModel: "gemini-3.8-flash",
  },
};

let currentMemberId =
  sessionStorage.getItem("jei_member_id") ||
  localStorage.getItem("jei_member_id") ||
  "m1";
let activeView = "chat";
let activeChannelId = "general";
let chatSearchQuery = "";
let taskOwnerFilter = "all";
let pendingAiSuggestedTasks = [];
let eventSource = null;

const memberSelect = document.getElementById("member-select");
const channelListEl = document.getElementById("channel-list");
const teamRosterEl = document.getElementById("team-roster");
const messagesContainer = document.getElementById("messages-container");
const pinnedBanner = document.getElementById("pinned-banner");
const activeChannelTitle = document.getElementById("active-channel-title");
const activeChannelDesc = document.getElementById("active-channel-desc");
const filesListEl = document.getElementById("files-list");
const filesCountEl = document.getElementById("files-count");
const ideasGrid = document.getElementById("ideas-grid");
const ideasCountEl = document.getElementById("ideas-count");
const tasksCountEl = document.getElementById("tasks-count");
const syncIndicator = document.getElementById("sync-indicator");
const syncLabel = document.getElementById("sync-label");
const toastEl = document.getElementById("toast");

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMessageText(raw) {
  const safe = escapeHtml(raw);
  return safe
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toastEl.classList.add("hidden"), 3000);
}

function getMember(id) {
  if (id === "ai") {
    return {
      id: "ai",
      name: "//CodeBreaker AI",
      initials: "AI",
      color: "#8b5cf6",
      role: "Gemini 3.8 Copilot",
      status: "Online",
    };
  }
  return (
    portalState.members.find((m) => m.id === id) || {
      id,
      name: "Teammate",
      initials: "TM",
      color: "#64748b",
      role: "Member",
      status: "Active",
    }
  );
}

async function apiCall(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed reading file"));
    reader.readAsDataURL(file);
  });
}

function connectStream() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(
    `/api/events?memberId=${encodeURIComponent(currentMemberId)}`
  );

  eventSource.onmessage = (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      if (payload.state) {
        portalState = payload.state;
        renderAll(payload.type === "message_created");
      }
      const tabs = portalState.presence?.connectedTabs || 1;
      syncIndicator.classList.remove("offline");
      syncLabel.textContent = `Live · ${tabs} tab${tabs === 1 ? "" : "s"}`;
    } catch (err) {
      console.error("SSE parse error:", err);
    }
  };

  eventSource.onerror = () => {
    syncIndicator.classList.add("offline");
    syncLabel.textContent = "Reconnecting...";
  };
}

function renderAll(scrollToBottom = false) {
  renderTopStatus();
  renderMemberSelectors();
  renderSidebar();
  renderChat(scrollToBottom);
  renderFiles();
  renderIdeas();
  renderTasks();
}

function renderTopStatus() {
  const aiPill = document.getElementById("btn-ai-key");
  const aiLabel = document.getElementById("ai-key-label");
  if (portalState.serverInfo?.aiConfigured) {
    aiPill.classList.add("live");
    aiPill.classList.remove("local");
    aiLabel.textContent = "Gemini 3.8 Live";
  } else {
    aiPill.classList.add("local");
    aiPill.classList.remove("live");
    aiLabel.textContent = "Setup AI Key";
  }
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const timerBtn = document.getElementById("btn-timer");
  const timerSpan = document.getElementById("timer-display");
  const t = portalState.timer;
  if (!t || t.mode !== "running" || !t.endsAt) {
    timerBtn.classList.remove("running", "freeze");
    timerSpan.textContent = "Warmup Mode";
    return;
  }
  const diffMs = new Date(t.endsAt).getTime() - Date.now();
  if (diffMs <= 0) {
    timerBtn.classList.remove("running");
    timerBtn.classList.add("freeze");
    timerSpan.textContent = "00:00:00 · Pencils Down!";
    return;
  }
  const totalSec = Math.floor(diffMs / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");

  const isFreeze = hrs < 4;
  timerBtn.classList.toggle("freeze", isFreeze);
  timerBtn.classList.toggle("running", !isFreeze);
  timerSpan.textContent = `${pad(hrs)}:${pad(mins)}:${pad(secs)}${
    isFreeze ? " · FREEZE!" : ""
  }`;
}

setInterval(updateTimerDisplay, 1000);

function renderMemberSelectors() {
  memberSelect.innerHTML = portalState.members
    .map(
      (m) =>
        `<option value="${escapeHtml(m.id)}" ${
          m.id === currentMemberId ? "selected" : ""
        }>${escapeHtml(m.name)}</option>`
    )
    .join("");

  const taskOwnerSelect = document.getElementById("task-owner-input");
  const prevOwner = taskOwnerSelect.value || currentMemberId;
  taskOwnerSelect.innerHTML = portalState.members
    .map(
      (m) =>
        `<option value="${escapeHtml(m.id)}" ${
          m.id === prevOwner ? "selected" : ""
        }>${escapeHtml(m.name)}</option>`
    )
    .join("");

  const filterSelect = document.getElementById("task-filter-owner");
  filterSelect.innerHTML =
    `<option value="all" ${
      taskOwnerFilter === "all" ? "selected" : ""
    }>All 3 Teammates</option>` +
    portalState.members
      .map(
        (m) =>
          `<option value="${escapeHtml(m.id)}" ${
            taskOwnerFilter === m.id ? "selected" : ""
          }>${escapeHtml(m.name)}</option>`
      )
      .join("");
}

function renderSidebar() {
  channelListEl.innerHTML = portalState.channels
    .map((ch) => {
      const count = portalState.messages.filter((m) => m.channelId === ch.id).length;
      const isActive = activeView === "chat" && activeChannelId === ch.id;
      return `
        <button class="channel-btn ${isActive ? "active" : ""}" data-channel="${escapeHtml(ch.id)}">
          <span># ${escapeHtml(ch.name)}</span>
          <span class="channel-count">${count}</span>
        </button>
      `;
    })
    .join("");

  const onlineSet = new Set(portalState.presence?.onlineMemberIds || []);
  teamRosterEl.innerHTML = portalState.members
    .map((m) => {
      const isOnline = onlineSet.has(m.id);
      return `
        <div class="roster-card">
          <div class="avatar" style="background:${escapeHtml(m.color)}">
            ${escapeHtml(m.initials)}
            <span class="presence-dot ${isOnline ? "online" : ""}" title="${
              isOnline ? "Connected now" : "Offline"
            }"></span>
          </div>
          <div class="roster-info">
            <div class="roster-name">${escapeHtml(m.name)}</div>
            <div class="roster-role">${escapeHtml(m.handle || m.role)}</div>
            <div class="roster-status">${escapeHtml(m.role)} · ● ${escapeHtml(m.status)}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderChat(scrollToBottom = false) {
  const channel =
    portalState.channels.find((c) => c.id === activeChannelId) ||
    portalState.channels[0];
  if (!channel) return;

  activeChannelTitle.textContent = `#${channel.name}`;
  activeChannelDesc.textContent = channel.description;
  document.getElementById(
    "chat-input"
  ).placeholder = `Message #${channel.name}, type @ai for AI help, or Ctrl+V paste a screenshot...`;

  let channelMsgs = portalState.messages.filter((m) => m.channelId === channel.id);
  const pinnedMsgs = channelMsgs.filter((m) => m.pinned);

  if (chatSearchQuery) {
    const q = chatSearchQuery.toLowerCase();
    channelMsgs = channelMsgs.filter((m) =>
      String(m.text || "").toLowerCase().includes(q)
    );
  }

  if (pinnedMsgs.length > 0) {
    pinnedBanner.classList.remove("hidden");
    pinnedBanner.innerHTML = pinnedMsgs
      .map((m) => {
        const author = getMember(m.authorId);
        return `<div>📌 <strong>${escapeHtml(author.name)}:</strong> ${escapeHtml(m.text)}</div>`;
      })
      .join("");
  } else {
    pinnedBanner.classList.add("hidden");
  }

  if (channelMsgs.length === 0) {
    messagesContainer.innerHTML = `
      <div class="empty-state">
        <p>No matching messages in <strong>#${escapeHtml(channel.name)}</strong>. Type a message or ask <code>@ai</code> below!</p>
      </div>
    `;
    return;
  }

  const wasNearBottom =
    messagesContainer.scrollHeight -
      messagesContainer.scrollTop -
      messagesContainer.clientHeight <
    140;

  messagesContainer.innerHTML = channelMsgs
    .map((m) => {
      const author = getMember(m.authorId);
      const badgeHtml =
        m.tag && m.tag !== "chat"
          ? `<span class="msg-badge badge-${escapeHtml(m.tag)}">${
              m.tag === "ai" ? "🤖 AI Copilot" : escapeHtml(m.tag)
            }</span>`
          : "";

      let attachmentHtml = "";
      if (m.attachmentId) {
        const fileObj = (portalState.files || []).find((f) => f.id === m.attachmentId);
        if (fileObj) {
          const isImg = (fileObj.mimeType || "").startsWith("image/");
          attachmentHtml = `
            <div class="msg-attachment-box">
              ${
                isImg
                  ? `<a href="/api/files/${encodeURIComponent(fileObj.id)}/raw" target="_blank"><img class="msg-attachment-img" src="/api/files/${encodeURIComponent(fileObj.id)}/raw" alt="${escapeHtml(fileObj.originalName)}" /></a>`
                  : ""
              }
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.78rem;">
                <span>📎 <strong>${escapeHtml(fileObj.originalName)}</strong> (${formatBytes(fileObj.sizeBytes)})</span>
                <a class="btn-ghost" href="/api/files/${encodeURIComponent(fileObj.id)}/raw" target="_blank">Open</a>
                <button class="btn-accent" data-action="jump-file" data-id="${escapeHtml(fileObj.id)}" style="padding:4px 9px;font-size:0.74rem;">
                  🔍 View AI Scan &amp; Ideas
                </button>
              </div>
            </div>
          `;
        }
      }

      const reactionButtons = EMOJIS.map((emoji) => {
        const reactors = (m.reactions && m.reactions[emoji]) || [];
        const active = reactors.includes(currentMemberId);
        const count = reactors.length;
        return `
          <button class="react-btn ${active ? "active" : ""}" data-action="react" data-id="${escapeHtml(m.id)}" data-emoji="${emoji}">
            ${emoji}${count > 0 ? ` ${count}` : ""}
          </button>
        `;
      }).join("");

      return `
        <div class="msg-card tag-${escapeHtml(m.tag || "chat")}">
          <div class="avatar" style="background:${escapeHtml(author.color)}">
            ${escapeHtml(author.initials)}
          </div>
          <div class="msg-body">
            <div class="msg-meta">
              <span class="msg-author">${escapeHtml(author.name)}</span>
              <span class="msg-time">${formatTime(m.createdAt)}</span>
              ${badgeHtml}
              ${m.pinned ? `<span class="msg-time">📌 Pinned</span>` : ""}
            </div>
            <div class="msg-text">${formatMessageText(m.text)}</div>
            ${attachmentHtml}
            <div class="msg-actions-row">
              <div class="reactions-wrap">${reactionButtons}</div>
              <div class="msg-tools">
                <button class="tool-link" data-action="pin" data-id="${escapeHtml(m.id)}">
                  ${m.pinned ? "Unpin" : "📌 Pin"}
                </button>
                <button class="tool-link" data-action="delete-msg" data-id="${escapeHtml(m.id)}">
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  if (scrollToBottom || wasNearBottom) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function renderFiles() {
  const files = portalState.files || [];
  filesCountEl.textContent = String(files.length);

  if (files.length === 0) {
    filesListEl.innerHTML = `
      <div class="empty-state">
        <h3>No attachments scanned yet</h3>
        <p style="margin-top:6px;">Drop a hackathon problem statement PDF, site photo, whiteboard sketch, CSV dataset, or code file above — AI will extract key insights and pitch 3 Gamuda ideas!</p>
      </div>
    `;
    return;
  }

  filesListEl.innerHTML = files
    .map((f) => {
      const uploader = getMember(f.uploadedBy);
      const isImg = (f.mimeType || "").startsWith("image/");
      const thumbHtml = isImg
        ? `<img class="file-thumb" src="/api/files/${encodeURIComponent(f.id)}/raw" alt="${escapeHtml(f.originalName)}" />`
        : `<div class="file-icon-box">📄</div>`;

      const analysis = f.analysis;
      let analysisHtml = `<div class="msg-time">Not scanned yet. Click "🔍 Re-Scan with AI" to analyze.</div>`;

      if (analysis) {
        const modeBadge =
          analysis.mode === "gemini"
            ? `<span class="msg-badge badge-snippet">✨ Gemini 3.8 Multimodal</span>`
            : `<span class="msg-badge badge-announcement">🧠 Smart Local Scan</span>`;

        const findingsHtml = (analysis.keyFindings || [])
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("");

        const genIdeasHtml = (analysis.generatedIdeas || [])
          .map(
            (gi, idx) => `
            <div class="scanned-idea-mini">
              <h4>💡 ${escapeHtml(gi.title)}</h4>
              <p><strong>Pain:</strong> ${escapeHtml(gi.problem)}</p>
              <p><strong>48h MVP:</strong> ${escapeHtml(gi.solution)}</p>
              <p style="color:#6ee7b7;"><strong>Impact:</strong> ${escapeHtml(gi.gamudaImpact)}</p>
              <button
                class="btn-primary"
                style="margin-top:auto;justify-content:center;font-size:0.76rem;padding:6px 10px;"
                data-action="adopt-scanned-idea"
                data-file-id="${escapeHtml(f.id)}"
                data-idea-idx="${idx}"
              >
                + Push to Idea Lab
              </button>
            </div>
          `
          )
          .join("");

        const squadTasksBtn =
          (analysis.squadPlan || []).length > 0
            ? `<button class="btn-ghost" data-action="adopt-scanned-tasks" data-file-id="${escapeHtml(f.id)}">📋 Push ${analysis.squadPlan.length} Squad Tasks to Sprint Board</button>`
            : "";

        analysisHtml = `
          <div class="ai-analysis-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
              <strong>🔍 AI Analysis &amp; Extracted Opportunities</strong>
              ${modeBadge}
            </div>
            <div style="font-size:0.84rem;line-height:1.5;color:#e2e8f0;">
              ${escapeHtml(analysis.summary)}
            </div>
            ${findingsHtml ? `<ul class="findings-list">${findingsHtml}</ul>` : ""}
            ${genIdeasHtml ? `<div class="scanned-ideas-grid">${genIdeasHtml}</div>` : ""}
            <div style="display:flex;justify-content:flex-end;">
              ${squadTasksBtn}
            </div>
          </div>
        `;
      }

      return `
        <div class="file-scan-card" id="vault-card-${escapeHtml(f.id)}">
          <div class="file-header-row">
            <div class="file-title-group">
              ${thumbHtml}
              <div>
                <div style="font-weight:700;font-size:0.96rem;">${escapeHtml(f.originalName)}</div>
                <div class="msg-time">
                  ${formatBytes(f.sizeBytes)} · ${escapeHtml(f.mimeType)} · Uploaded by ${escapeHtml(uploader.name)} at ${formatTime(f.createdAt)}
                </div>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <a class="btn-ghost" href="/api/files/${encodeURIComponent(f.id)}/raw" target="_blank">↗ Open / Download</a>
              <button class="btn-accent" data-action="rescan-file" data-file-id="${escapeHtml(f.id)}">🔍 Re-Scan with AI</button>
              <button class="btn-ghost" data-action="delete-file" data-file-id="${escapeHtml(f.id)}">🗑️</button>
            </div>
          </div>
          ${analysisHtml}
        </div>
      `;
    })
    .join("");
}

function renderIdeas() {
  ideasCountEl.textContent = String(portalState.ideas.length);

  const sorted = [...portalState.ideas].sort(
    (a, b) => (b.votes?.length || 0) - (a.votes?.length || 0)
  );

  if (sorted.length === 0) {
    ideasGrid.innerHTML = `<div class="empty-state">No ideas pitched yet. Click "+ Pitch New Idea" or scan a file in 📎 AI File Scanner!</div>`;
    return;
  }

  ideasGrid.innerHTML = sorted
    .map((idea) => {
      const author = getMember(idea.authorId);
      const votes = idea.votes || [];
      const hasVoted = votes.includes(currentMemberId);
      const voterAvatars = votes
        .map((vid) => {
          const vm = getMember(vid);
          return `<span class="mini-avatar" style="background:${escapeHtml(vm.color)}" title="${escapeHtml(vm.name)} voted">${escapeHtml(vm.initials)}</span>`;
        })
        .join("");

      const tagsHtml = (idea.tags || [])
        .map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`)
        .join("");

      const commentsHtml = (idea.comments || [])
        .map((c) => {
          const cm = getMember(c.authorId);
          return `<div class="comment-item"><strong>${escapeHtml(cm.name)}:</strong> ${escapeHtml(c.text)}</div>`;
        })
        .join("");

      const scoreBadge = idea.pitchDeck?.scores?.total
        ? `<span class="msg-badge badge-snippet">🏆 Judge Score: ${idea.pitchDeck.scores.total}/100</span>`
        : "";

      return `
        <article class="idea-card">
          <div class="idea-top">
            <div>
              <div class="idea-title">${escapeHtml(idea.title)}</div>
              <div class="msg-time">
                Pitched by ${escapeHtml(author.name)}${
                  idea.sourceFileName ? ` · from 📎 ${escapeHtml(idea.sourceFileName)}` : ""
                }
              </div>
              ${scoreBadge ? `<div style="margin-top:4px;">${scoreBadge}</div>` : ""}
            </div>
            <button class="vote-btn ${hasVoted ? "voted" : ""}" data-action="vote-idea" data-id="${escapeHtml(idea.id)}">
              <span>▲</span>
              <span>${votes.length}/3</span>
            </button>
          </div>

          ${idea.problem ? `<div class="idea-field"><strong>Problem:</strong> ${escapeHtml(idea.problem)}</div>` : ""}
          ${idea.solution ? `<div class="idea-field"><strong>48h MVP:</strong> ${escapeHtml(idea.solution)}</div>` : ""}
          ${idea.gamudaImpact ? `<div class="impact-box">🎯 <strong>Gamuda Impact:</strong> ${escapeHtml(idea.gamudaImpact)}</div>` : ""}
          ${tagsHtml ? `<div class="tag-list">${tagsHtml}</div>` : ""}

          <div class="voter-row">
            <div style="display:flex;align-items:center;gap:6px;">
              <span>Votes:</span>
              <div class="voter-avatars">${voterAvatars || "<span>0</span>"}</div>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn-accent" style="padding:5px 10px;font-size:0.75rem;" data-action="pitch-coach" data-id="${escapeHtml(idea.id)}">
                🎤 3-Min Pitch &amp; Score
              </button>
              <button class="btn-ghost" style="padding:5px 8px;font-size:0.74rem;" data-action="delete-idea" data-id="${escapeHtml(idea.id)}" title="Delete idea">
                🗑️
              </button>
            </div>
          </div>

          <div class="idea-comments">
            ${commentsHtml || `<div class="msg-time">Squad discussion:</div>`}
            <form class="comment-form" data-idea-id="${escapeHtml(idea.id)}">
              <input type="text" name="commentText" placeholder="Add comment..." required />
              <button type="submit" class="btn-ghost">Reply</button>
            </form>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTasks() {
  const openTasks = portalState.tasks.filter((t) => t.status !== "done").length;
  tasksCountEl.textContent = String(openTasks);

  const filtered =
    taskOwnerFilter === "all"
      ? portalState.tasks
      : portalState.tasks.filter((t) => t.ownerId === taskOwnerFilter);

  const cols = { todo: [], doing: [], done: [] };
  for (const t of filtered) {
    (cols[t.status] || cols.todo).push(t);
  }

  document.getElementById("count-todo").textContent = String(cols.todo.length);
  document.getElementById("count-doing").textContent = String(cols.doing.length);
  document.getElementById("count-done").textContent = String(cols.done.length);

  const renderCard = (t) => {
    const owner = getMember(t.ownerId);
    const prevStatus =
      t.status === "done" ? "doing" : t.status === "doing" ? "todo" : null;
    const nextStatus =
      t.status === "todo" ? "doing" : t.status === "doing" ? "done" : null;

    return `
      <div class="task-card">
        <div class="task-title">${escapeHtml(t.title)}</div>
        <div class="task-footer">
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="mini-avatar" style="background:${escapeHtml(owner.color)}" title="${escapeHtml(owner.name)}">${escapeHtml(owner.initials)}</span>
            <span class="module-chip">${escapeHtml(t.module)}/</span>
          </div>
          <div class="task-btns">
            ${prevStatus ? `<button class="mini-btn" data-action="move-task" data-id="${escapeHtml(t.id)}" data-status="${prevStatus}">←</button>` : ""}
            ${nextStatus ? `<button class="mini-btn" data-action="move-task" data-id="${escapeHtml(t.id)}" data-status="${nextStatus}">→</button>` : ""}
            <button class="mini-btn" data-action="delete-task" data-id="${escapeHtml(t.id)}" title="Delete task">✕</button>
          </div>
        </div>
      </div>
    `;
  };

  document.getElementById("col-todo").innerHTML = cols.todo.map(renderCard).join("");
  document.getElementById("col-doing").innerHTML = cols.doing.map(renderCard).join("");
  document.getElementById("col-done").innerHTML = cols.done.map(renderCard).join("");
}

function switchView(viewName) {
  activeView = viewName;
  document.querySelectorAll(".nav-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
  document.querySelectorAll(".view-section").forEach((sec) => {
    sec.classList.toggle("active", sec.id === `view-${viewName}`);
  });
  renderSidebar();
}

document.querySelectorAll(".nav-pill").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

channelListEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-channel]");
  if (!btn) return;
  activeChannelId = btn.dataset.channel;
  switchView("chat");
  renderChat(true);
});

memberSelect.addEventListener("change", () => {
  currentMemberId = memberSelect.value;
  sessionStorage.setItem("jei_member_id", currentMemberId);
  localStorage.setItem("jei_member_id", currentMemberId);
  connectStream();
  renderAll();
  showToast(`Posting as ${getMember(currentMemberId).name}`);
});

document.getElementById("chat-search-input").addEventListener("input", (e) => {
  chatSearchQuery = e.target.value.trim();
  renderChat(false);
});

document.getElementById("btn-ai-summarize").addEventListener("click", async () => {
  showToast("🤖 //CodeBreaker AI is summarizing this channel...");
  await apiCall("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      channelId: activeChannelId,
      question:
        "Summarize our recent messages in this channel, highlight any blockers, and list 3 clear next actions for CodeKeeper, J_SON, and CodeZero.",
    }),
  });
});

document.getElementById("btn-insert-ai").addEventListener("click", () => {
  const input = document.getElementById("chat-input");
  if (!input.value.includes("@ai")) {
    input.value = `@ai ${input.value}`.trim() + " ";
  }
  input.focus();
});

async function uploadAndScanFile(file, opts = {}) {
  if (!file) return null;
  if (file.size > 25 * 1024 * 1024) {
    showToast("File exceeds 25 MB limit");
    return null;
  }
  const dataBase64 = await fileToBase64(file);
  const res = await apiCall("/api/files", {
    method: "POST",
    body: JSON.stringify({
      originalName: file.name || "pasted-screenshot.png",
      mimeType: file.type || "application/octet-stream",
      dataBase64,
      uploadedBy: currentMemberId,
      autoAnalyze: true,
      userPrompt: opts.userPrompt || "",
      postToChannel: Boolean(opts.postToChannel),
      channelId: opts.channelId || activeChannelId,
      messageText: opts.messageText || "",
    }),
  });
  return res.file;
}

document.getElementById("chat-file-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = "";
  const banner = document.getElementById("chat-upload-status");
  banner.classList.remove("hidden");
  banner.textContent = `⏳ Uploading "${file.name}" & scanning with AI...`;
  try {
    await uploadAndScanFile(file, {
      postToChannel: true,
      channelId: activeChannelId,
    });
    showToast(`Uploaded & scanned "${file.name}"!`);
  } catch (err) {
    showToast(`Upload failed: ${err.message}`);
  } finally {
    banner.classList.add("hidden");
  }
});

const chatInput = document.getElementById("chat-input");
chatInput.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) {
        const banner = document.getElementById("chat-upload-status");
        banner.classList.remove("hidden");
        banner.textContent = "⏳ Pasting screenshot & running AI visual scan...";
        try {
          const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
          const namedFile = new File(
            [file],
            file.name && file.name !== "image.png" ? file.name : `screenshot-${stamp}.png`,
            { type: file.type || "image/png" }
          );
          await uploadAndScanFile(namedFile, {
            postToChannel: true,
            channelId: activeChannelId,
            messageText: chatInput.value.trim()
              ? `${chatInput.value.trim()} (📎 pasted screenshot)`
              : "",
          });
          chatInput.value = "";
          showToast("Screenshot posted & scanned by AI!");
        } catch (err) {
          showToast(`Paste upload failed: ${err.message}`);
        } finally {
          banner.classList.add("hidden");
        }
      }
    }
  }
});

const dropzone = document.getElementById("file-dropzone");
const vaultInput = document.getElementById("vault-file-input");

async function handleVaultUpload(file) {
  if (!file) return;
  const uploadingBar = document.getElementById("vault-uploading-bar");
  const promptInput = document.getElementById("vault-prompt-input");
  const shareCheck = document.getElementById("vault-share-chat");

  uploadingBar.classList.remove("hidden");
  uploadingBar.textContent = `⏳ Scanning "${file.name}" & generating Gamuda hackathon ideas...`;
  try {
    await uploadAndScanFile(file, {
      userPrompt: promptInput.value.trim(),
      postToChannel: shareCheck.checked,
      channelId: "idea-lab",
    });
    promptInput.value = "";
    showToast(`✨ AI scan complete for "${file.name}"!`);
  } catch (err) {
    showToast(`Scan failed: ${err.message}`);
  } finally {
    uploadingBar.classList.add("hidden");
  }
}

vaultInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  handleVaultUpload(file);
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  handleVaultUpload(e.dataTransfer?.files?.[0]);
});

filesListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, fileId } = btn.dataset;
  const fileObj = (portalState.files || []).find((f) => f.id === fileId);
  if (!fileObj) return;

  if (action === "adopt-scanned-idea") {
    const gi = fileObj.analysis?.generatedIdeas?.[Number(btn.dataset.ideaIdx)];
    if (!gi) return;
    await apiCall("/api/ideas", {
      method: "POST",
      body: JSON.stringify({
        authorId: currentMemberId,
        title: gi.title,
        problem: gi.problem,
        solution: gi.solution,
        gamudaImpact: gi.gamudaImpact,
        tags: gi.tags || ["Scanned Attachment"],
        sourceFileName: fileObj.originalName,
      }),
    });
    showToast(`Added "${gi.title}" to Idea Lab!`);
  } else if (action === "adopt-scanned-tasks") {
    const plan = fileObj.analysis?.squadPlan || [];
    const modules = ["frontend", "backend", "ai-engine"];
    const memberIds = portalState.members.map((m) => m.id);
    for (let i = 0; i < plan.length; i++) {
      await apiCall("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: plan[i],
          ownerId: memberIds[i % memberIds.length] || currentMemberId,
          module: modules[i % modules.length],
          status: "todo",
        }),
      });
    }
    showToast("Pushed 3 squad tasks to Sprint Board!");
  } else if (action === "rescan-file") {
    const customFocus = document.getElementById("vault-prompt-input").value.trim() || "";
    btn.textContent = "⏳ Scanning...";
    await apiCall(`/api/files/${encodeURIComponent(fileId)}/analyze`, {
      method: "POST",
      body: JSON.stringify({ userPrompt: customFocus }),
    });
    showToast(`Re-scanned "${fileObj.originalName}"!`);
  } else if (action === "delete-file") {
    await apiCall(`/api/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    showToast("Attachment removed");
  }
});

document.getElementById("btn-share-link").addEventListener("click", async () => {
  const shareUrl = portalState.serverInfo?.lanUrls?.[0] || window.location.origin;
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast(`Copied team link: ${shareUrl}`);
  } catch {
    prompt("Copy this URL for teammates on the same Wi-Fi/VPN:", shareUrl);
  }
});

const chatForm = document.getElementById("chat-form");
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  const tag = document.querySelector('input[name="msgTag"]:checked')?.value || "chat";
  chatInput.value = "";
  await apiCall("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      channelId: activeChannelId,
      authorId: currentMemberId,
      text,
      tag,
    }),
  });
});

messagesContainer.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id, emoji } = btn.dataset;
  if (action === "react") {
    await apiCall(`/api/messages/${encodeURIComponent(id)}/react`, {
      method: "POST",
      body: JSON.stringify({ memberId: currentMemberId, emoji }),
    });
  } else if (action === "pin") {
    await apiCall(`/api/messages/${encodeURIComponent(id)}/pin`, { method: "POST" });
  } else if (action === "delete-msg") {
    await apiCall(`/api/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
  } else if (action === "jump-file") {
    switchView("files");
    setTimeout(() => {
      document.getElementById(`vault-card-${id}`)?.scrollIntoView({ behavior: "smooth" });
    }, 60);
  }
});

const pitchModal = document.getElementById("pitch-modal");
document
  .getElementById("btn-close-pitch-modal")
  .addEventListener("click", () => pitchModal.classList.add("hidden"));

function renderPitchModal(idea, deck) {
  document.getElementById("pitch-modal-title").textContent = `🎤 ${idea.title}`;
  const s = deck.scores || {};
  const scriptHtml = (deck.pitchScript || [])
    .map(
      (part) => `
      <div class="script-step">
        <div style="font-weight:700;color:#93c5fd;margin-bottom:4px;">
          🎙️ ${escapeHtml(part.speaker)} · <span style="color:#6ee7b7;">${escapeHtml(part.timeWindow)}</span>
        </div>
        <div>${escapeHtml(part.talkingPoints)}</div>
      </div>
    `
    )
    .join("");

  const qaHtml = (deck.judgeQA || [])
    .map(
      (qa) => `
      <div style="background:var(--bg-input);padding:10px;border-radius:8px;font-size:0.81rem;">
        <div style="color:#fde68a;font-weight:700;">❓ Judge: ${escapeHtml(qa.question)}</div>
        <div style="margin-top:4px;color:#cbd5e1;">💡 Winning Answer: ${escapeHtml(qa.winningAnswer)}</div>
      </div>
    `
    )
    .join("");

  const blindHtml = (deck.blindSpots || [])
    .map((b) => `<li>${escapeHtml(b)}</li>`)
    .join("");

  document.getElementById("pitch-modal-body").innerHTML = `
    <div class="score-bar-grid">
      <div class="score-tile"><div class="num">${s.gamudaImpact ?? 22}/25</div><div class="lbl">Gamuda ROI</div></div>
      <div class="score-tile"><div class="num">${s.innovation ?? 22}/25</div><div class="lbl">Innovation</div></div>
      <div class="score-tile"><div class="num">${s.feasibility48h ?? 22}/25</div><div class="lbl">48h Build</div></div>
      <div class="score-tile"><div class="num">${s.demoWow ?? 22}/25</div><div class="lbl">Stage Wow</div></div>
      <div class="score-tile" style="border-color:#10b981;"><div class="num">${s.total ?? 88}/100</div><div class="lbl">Total Score</div></div>
    </div>
    <div class="impact-box">⚖️ <strong>Judge Verdict:</strong> ${escapeHtml(deck.verdict || "")}</div>
    ${blindHtml ? `<div><strong style="font-size:0.82rem;">⚠️ Blind Spots to Watch:</strong><ul class="findings-list" style="margin-top:5px;">${blindHtml}</ul></div>` : ""}
    <h4 style="font-size:0.9rem;">⏱️ 3-Person Timed Stage Script (CodeKeeper · J_SON · CodeZero)</h4>
    <div style="display:flex;flex-direction:column;gap:8px;">${scriptHtml}</div>
    <h4 style="font-size:0.9rem;">🛡️ Tough Judge Q&amp;A Prep</h4>
    <div style="display:flex;flex-direction:column;gap:8px;">${qaHtml}</div>
  `;
  pitchModal.classList.remove("hidden");
}

ideasGrid.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === "vote-idea") {
    await apiCall(`/api/ideas/${encodeURIComponent(id)}/vote`, {
      method: "POST",
      body: JSON.stringify({ memberId: currentMemberId }),
    });
  } else if (action === "pitch-coach") {
    const idea = portalState.ideas.find((i) => i.id === id);
    if (!idea) return;
    if (idea.pitchDeck) {
      renderPitchModal(idea, idea.pitchDeck);
      return;
    }
    const orig = btn.textContent;
    btn.textContent = "⏳ Coaching...";
    try {
      const res = await apiCall(`/api/ideas/${encodeURIComponent(id)}/pitch`, {
        method: "POST",
      });
      renderPitchModal(idea, res.pitchDeck);
    } finally {
      btn.textContent = orig;
    }
  } else if (action === "delete-idea") {
    await apiCall(`/api/ideas/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
});

ideasGrid.addEventListener("submit", async (e) => {
  const form = e.target.closest(".comment-form");
  if (!form) return;
  e.preventDefault();
  const input = form.elements.commentText;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await apiCall(`/api/ideas/${encodeURIComponent(form.dataset.ideaId)}/comment`, {
    method: "POST",
    body: JSON.stringify({ authorId: currentMemberId, text }),
  });
});

const ideaModal = document.getElementById("idea-modal");
const openIdeaModal = () => {
  pendingAiSuggestedTasks = [];
  document.getElementById("ai-tasks-checkbox-wrap").classList.add("hidden");
  document.getElementById("ai-status-msg").classList.add("hidden");
  ideaModal.classList.remove("hidden");
};
const closeIdeaModal = () => ideaModal.classList.add("hidden");

document.getElementById("btn-open-idea-modal").addEventListener("click", openIdeaModal);
document.getElementById("btn-close-idea-modal").addEventListener("click", closeIdeaModal);
document.getElementById("btn-cancel-idea").addEventListener("click", closeIdeaModal);

document.getElementById("btn-ai-sharpen").addEventListener("click", async () => {
  const topic = document.getElementById("ai-topic-input").value.trim();
  const statusEl = document.getElementById("ai-status-msg");
  statusEl.classList.remove("hidden");
  statusEl.textContent = "⏳ Generating structured Gamuda pitch...";

  try {
    const drafted = await apiCall("/api/ai/brainstorm", {
      method: "POST",
      body: JSON.stringify({
        topic: topic || document.getElementById("idea-title").value,
        roughNotes: document.getElementById("idea-problem").value,
      }),
    });

    document.getElementById("idea-title").value = drafted.title || "";
    document.getElementById("idea-problem").value = drafted.problem || "";
    document.getElementById("idea-solution").value = drafted.solution || "";
    document.getElementById("idea-impact").value = drafted.gamudaImpact || "";
    document.getElementById("idea-tags").value = (drafted.tags || []).join(", ");

    pendingAiSuggestedTasks = drafted.suggestedTasks || [];
    if (pendingAiSuggestedTasks.length > 0) {
      document.getElementById("ai-tasks-checkbox-wrap").classList.remove("hidden");
    }

    statusEl.textContent =
      drafted.mode === "gemini"
        ? "✨ Drafted live with Gemini 3.8 Flash! Review & submit below."
        : "✨ Drafted via Smart Coach (click 🔑 Setup AI Key anytime for live Gemini 3.8 Flash).";
  } catch (err) {
    statusEl.textContent = `Could not draft pitch: ${err.message}`;
  }
});

document.getElementById("idea-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("idea-title").value.trim();
  const problem = document.getElementById("idea-problem").value.trim();
  const solution = document.getElementById("idea-solution").value.trim();
  const gamudaImpact = document.getElementById("idea-impact").value.trim();
  const tags = document
    .getElementById("idea-tags")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  await apiCall("/api/ideas", {
    method: "POST",
    body: JSON.stringify({
      authorId: currentMemberId,
      title,
      problem,
      solution,
      gamudaImpact,
      tags,
    }),
  });

  const shouldAddTasks =
    !document.getElementById("ai-tasks-checkbox-wrap").classList.contains("hidden") &&
    document.getElementById("ai-add-tasks-check").checked;

  if (shouldAddTasks && pendingAiSuggestedTasks.length > 0) {
    const modules = ["frontend", "backend", "ai-engine"];
    const memberIds = portalState.members.map((m) => m.id);
    for (let i = 0; i < pendingAiSuggestedTasks.length; i++) {
      await apiCall("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: pendingAiSuggestedTasks[i],
          ownerId: memberIds[i % memberIds.length] || currentMemberId,
          module: modules[i % modules.length],
          status: "todo",
        }),
      });
    }
  }

  e.target.reset();
  closeIdeaModal();
  showToast("Idea posted to Idea Lab!");
});

const aiKeyModal = document.getElementById("ai-key-modal");
document.getElementById("btn-ai-key").addEventListener("click", () => aiKeyModal.classList.remove("hidden"));
document.getElementById("btn-close-ai-key-modal").addEventListener("click", () => aiKeyModal.classList.add("hidden"));
document.getElementById("btn-cancel-ai-key").addEventListener("click", () => aiKeyModal.classList.add("hidden"));

document.getElementById("ai-key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("ai-key-input");
  const apiKey = input.value.trim();
  if (!apiKey) return;
  await apiCall("/api/settings/ai-key", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
  input.value = "";
  aiKeyModal.classList.add("hidden");
  showToast("✨ Gemini 3.8 Flash activated for //CodeBreaker!");
});

const timerModal = document.getElementById("timer-modal");
document.getElementById("btn-timer").addEventListener("click", () => timerModal.classList.remove("hidden"));
document.getElementById("btn-close-timer-modal").addEventListener("click", () => timerModal.classList.add("hidden"));

document.getElementById("btn-start-48h").addEventListener("click", async () => {
  await apiCall("/api/timer", {
    method: "POST",
    body: JSON.stringify({ action: "start48h", hours: 48 }),
  });
  timerModal.classList.add("hidden");
  showToast("🚀 48-Hour Hackathon Countdown started for all 3 teammates!");
});

document.getElementById("btn-start-4h-freeze").addEventListener("click", async () => {
  await apiCall("/api/timer", {
    method: "POST",
    body: JSON.stringify({ action: "start48h", hours: 3.99 }),
  });
  timerModal.classList.add("hidden");
  showToast("❄️ T-Minus 4h Feature Freeze alert activated!");
});

document.getElementById("btn-reset-timer").addEventListener("click", async () => {
  await apiCall("/api/timer", {
    method: "POST",
    body: JSON.stringify({ action: "reset" }),
  });
  timerModal.classList.add("hidden");
  showToast("Reset to Pre-Hackathon Warmup mode");
});

document.getElementById("task-filter-owner").addEventListener("change", (e) => {
  taskOwnerFilter = e.target.value;
  renderTasks();
});

document.getElementById("task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const titleEl = document.getElementById("task-title-input");
  const title = titleEl.value.trim();
  if (!title) return;
  const ownerId = document.getElementById("task-owner-input").value;
  const module = document.getElementById("task-module-input").value;
  titleEl.value = "";
  await apiCall("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title, ownerId, module, status: "todo" }),
  });
});

document.getElementById("view-tasks").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id, status } = btn.dataset;
  if (action === "move-task") {
    await apiCall(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  } else if (action === "delete-task") {
    await apiCall(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
});

const profileModal = document.getElementById("profile-modal");
document.getElementById("btn-edit-profile").addEventListener("click", () => {
  const me = getMember(currentMemberId);
  document.getElementById("profile-name").value = me.name || "";
  document.getElementById("profile-handle").value = me.handle || "";
  document.getElementById("profile-role").value = me.role || "";
  document.getElementById("profile-status").value = me.status || "";
  profileModal.classList.remove("hidden");
});

const closeProfileModal = () => profileModal.classList.add("hidden");
document.getElementById("btn-close-profile-modal").addEventListener("click", closeProfileModal);
document.getElementById("btn-cancel-profile").addEventListener("click", closeProfileModal);

document.getElementById("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await apiCall(`/api/members/${encodeURIComponent(currentMemberId)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: document.getElementById("profile-name").value,
      handle: document.getElementById("profile-handle").value,
      role: document.getElementById("profile-role").value,
      status: document.getElementById("profile-status").value,
    }),
  });
  closeProfileModal();
  showToast("Profile & status updated!");
});

(async function init() {
  try {
    portalState = await apiCall("/api/state");
    renderAll(true);
    connectStream();
  } catch (err) {
    console.error("Failed loading initial portal state:", err);
  }
})();
