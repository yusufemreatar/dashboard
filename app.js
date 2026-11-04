const TASK_STORAGE_KEY = "dashboardTasksV1";
const LOGIN_STORAGE_KEY = "dashboardLoggedInV1";
const ACTIVITY_STORAGE_KEY = "dashboardActivityV1";
const MAX_TASK_HISTORY = 12;
const MAX_ACTIVITY_LOG = 80;

const UI_STATE = {
    taskFilter: "all",
    editingTaskId: null,
    taskSearch: "",
    taskSort: "deadline"
};

const MEDIA_STATE = {
    audioUrl: "",
    videoUrl: "",
    videoPromise: null,
    clickContext: null,
    clickFallbackUrl: "",
    clickFallbackAudio: null,
    clickLastTime: 0
};

const DEFAULT_TASKS = [
    { id: "task-html", title: "Study HTML", priority: "medium", checked: false, custom: false },
    { id: "task-css-grid", title: "Learn CSS Grid", priority: "high", checked: false, custom: false },
    { id: "task-dashboard", title: "Improve dashboard", priority: "low", checked: false, custom: false }
];

const SKILL_PROGRESS = [
    { title: "HTML", percent: 85, tone: "cyan" },
    { title: "CSS", percent: 70, tone: "blue" },
    { title: "JavaScript", percent: 55, tone: "amber" }
];

document.addEventListener("DOMContentLoaded", () => {
    if (!handleAuthFlow()) {
        return;
    }

    markActiveNavigation();
    wireLogoutButton();
    ensureTaskStorage();
    ensureActivityStorage();
    wireTaskEditorModal();
    ensureToastContainer();
    wireGlobalClickSound();
    renderAllViews();
});

function handleAuthFlow() {
    const page = document.body.dataset.page;
    const isLoggedIn = localStorage.getItem(LOGIN_STORAGE_KEY) === "1";
    const loginForm = document.getElementById("loginForm");

    if (loginForm) {
        if (isLoggedIn) {
            window.location.replace("index.html");
            return false;
        }

        loginForm.addEventListener("submit", (event) => {
            event.preventDefault();
            localStorage.setItem(LOGIN_STORAGE_KEY, "1");
            ensureTaskStorage();
            ensureActivityStorage();
            window.location.replace("index.html");
        });

        return true;
    }

    if (page !== "login" && !isLoggedIn) {
        window.location.replace("login.html");
        return false;
    }

    return true;
}

function wireLogoutButton() {
    const logoutButton = document.getElementById("logoutBtn");
    if (!logoutButton) {
        return;
    }

    logoutButton.addEventListener("click", () => {
        localStorage.removeItem(LOGIN_STORAGE_KEY);
        window.location.replace("login.html");
    });
}

function markActiveNavigation() {
    const page = document.body.dataset.page;
    document.querySelectorAll("[data-nav]").forEach((link) => {
        link.classList.toggle("active", link.dataset.nav === page);
    });
}

function ensureTaskStorage() {
    const raw = localStorage.getItem(TASK_STORAGE_KEY);

    if (!raw) {
        replaceTasks(DEFAULT_TASKS);
        return;
    }

    try {
        const parsed = JSON.parse(raw);
        const normalized = Array.isArray(parsed)
            ? parsed.map((task, index) => normalizeTask(task, index))
            : DEFAULT_TASKS.map((task, index) => normalizeTask(task, index));
        saveTasks(normalized);
    } catch (error) {
        replaceTasks(DEFAULT_TASKS);
    }
}

function ensureActivityStorage() {
    const existing = getActivityLog();

    if (existing.length) {
        saveActivityLog(existing);
        return;
    }

    const seeded = getTasks()
        .flatMap((task) => task.history.map((entry) => normalizeActivityEntry({
            id: entry.id,
            taskId: task.id,
            taskTitle: task.title,
            action: entry.action,
            note: entry.note,
            at: entry.at,
            priority: task.priority,
            dueDate: task.dueDate
        })))
        .sort((a, b) => new Date(a.at) - new Date(b.at))
        .slice(-MAX_ACTIVITY_LOG);

    saveActivityLog(seeded);
}

function replaceTasks(tasks) {
    saveTasks(tasks.map((task, index) => normalizeTask(task, index)));
}

function saveTasks(tasks) {
    localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
}

function getTasks() {
    try {
        const raw = localStorage.getItem(TASK_STORAGE_KEY);
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed)
            ? parsed.map((task, index) => normalizeTask(task, index))
            : DEFAULT_TASKS.map((task, index) => normalizeTask(task, index));
    } catch (error) {
        return DEFAULT_TASKS.map((task, index) => normalizeTask(task, index));
    }
}

function saveActivityLog(entries) {
    const normalized = entries
        .map((entry) => normalizeActivityEntry(entry))
        .sort((a, b) => new Date(a.at) - new Date(b.at))
        .slice(-MAX_ACTIVITY_LOG);

    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(normalized));
}

function getActivityLog() {
    try {
        const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed)
            ? parsed.map((entry) => normalizeActivityEntry(entry))
            : [];
    } catch (error) {
        return [];
    }
}

function normalizeTask(task, index) {
    const fallbackTitle = `Task ${index + 1}`;
    const rawTitle = typeof task.title === "string" && task.title.trim() ? task.title.trim() : fallbackTitle;
    const title = translateLegacyTaskTitle(rawTitle);
    const id = task.id || `task-${index + 1}-${slugify(title)}`;
    const priority = ["low", "medium", "high"].includes(task.priority)
        ? task.priority
        : mapLegacyPriority(task.badgeClass, task.badgeText);
    const custom = Boolean(task.custom);
    const createdAt = task.createdAt || new Date().toISOString();
    const updatedAt = task.updatedAt || createdAt;
    const hasStructuredSubtasks = Array.isArray(task.subtasks) && task.subtasks.length > 0;
    const legacyCompleted = !hasStructuredSubtasks && (Boolean(task.checked) || task.status === "completed");
    const subtasks = normalizeSubtasks(task.subtasks, title, legacyCompleted, id);
    const status = deriveTaskStatus(subtasks, task.status);
    const progress = calculateProgress(subtasks);
    const dueDate = normalizeDateInput(task.dueDate) || suggestDueDate(priority, index);
    const reason = typeof task.reason === "string" ? task.reason.trim() : "";
    const history = normalizeTaskHistory(task.history, title, createdAt, id);

    return {
        id,
        title,
        priority,
        custom,
        status,
        reason,
        progress,
        subtasks,
        dueDate,
        history,
        createdAt,
        updatedAt,
        checked: status === "completed"
    };
}

function normalizeSubtasks(subtasks, title, forceCompleted, taskId) {
    const source = Array.isArray(subtasks) && subtasks.length ? subtasks : generateSubtasks(title);

    return source.slice(0, 3).map((subtask, index) => ({
        id: subtask.id || `${taskId}-subtask-${index + 1}`,
        title: typeof subtask.title === "string" && subtask.title.trim()
            ? subtask.title.trim()
            : `Subtask ${index + 1}`,
        done: forceCompleted ? true : Boolean(subtask.done)
    }));
}

function normalizeTaskHistory(history, title, createdAt, taskId) {
    const source = Array.isArray(history) && history.length
        ? history
        : [{ action: "created", note: `Task "${title}" was added to the board.`, at: createdAt }];

    return source
        .map((entry, index) => ({
            id: entry.id || `${taskId}-history-${index + 1}`,
            action: normalizeActivityAction(entry.action),
            note: typeof entry.note === "string" && entry.note.trim()
                ? entry.note.trim()
                : "Task updated.",
            at: entry.at || createdAt
        }))
        .sort((a, b) => new Date(a.at) - new Date(b.at))
        .slice(-MAX_TASK_HISTORY);
}

function normalizeActivityEntry(entry) {
    const at = entry.at || new Date().toISOString();

    return {
        id: entry.id || `activity-${Date.parse(at) || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        taskId: entry.taskId || "",
        taskTitle: typeof entry.taskTitle === "string" && entry.taskTitle.trim() ? entry.taskTitle.trim() : "Task",
        action: normalizeActivityAction(entry.action),
        note: typeof entry.note === "string" && entry.note.trim() ? entry.note.trim() : "Task updated.",
        at,
        priority: ["low", "medium", "high"].includes(entry.priority) ? entry.priority : "medium",
        dueDate: normalizeDateInput(entry.dueDate)
    };
}

function normalizeActivityAction(action) {
    const allowed = ["created", "updated", "blocked", "skipped", "cancelled", "completed", "deleted", "resumed", "reopened"];
    return allowed.includes(action) ? action : "updated";
}

function deriveTaskStatus(subtasks, preferredStatus) {
    if (["blocked", "skipped", "cancelled"].includes(preferredStatus)) {
        return preferredStatus;
    }

    const doneCount = subtasks.filter((subtask) => subtask.done).length;

    if (doneCount === subtasks.length && subtasks.length > 0) {
        return "completed";
    }

    if (doneCount > 0) {
        return "in_progress";
    }

    return "pending";
}

function calculateProgress(subtasks) {
    if (!subtasks.length) {
        return 0;
    }

    const doneCount = subtasks.filter((subtask) => subtask.done).length;
    return Math.round((doneCount / subtasks.length) * 100);
}

function translateLegacyTaskTitle(title) {
    const translations = {
        "HTML calis": "Study HTML",
        "CSS Grid ogren": "Learn CSS Grid",
        "Dashboard gelistir": "Improve dashboard"
    };

    return translations[title] || title;
}

function mapLegacyPriority(badgeClass = "", badgeText = "") {
    const value = `${badgeClass} ${badgeText}`.toLowerCase();

    if (value.includes("high")) return "high";
    if (value.includes("low")) return "low";
    return "medium";
}

function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "item";
}

function generateSubtasks(title) {
    const value = title.toLowerCase();

    if (value.includes("dashboard")) {
        return [
            { title: "Refine layout hierarchy", done: false },
            { title: "Upgrade visual analytics", done: false },
            { title: "Polish page interactions", done: false }
        ];
    }

    if (value.includes("html")) {
        return [
            { title: "Review semantic structure", done: false },
            { title: "Build reusable sections", done: false },
            { title: "Test responsive markup", done: false }
        ];
    }

    if (value.includes("css")) {
        return [
            { title: "Define layout strategy", done: false },
            { title: "Apply component styling", done: false },
            { title: "Polish responsive states", done: false }
        ];
    }

    if (value.includes("javascript") || value.includes("js")) {
        return [
            { title: "Plan interaction flow", done: false },
            { title: "Implement logic", done: false },
            { title: "Verify state updates", done: false }
        ];
    }

    if (value.includes("react")) {
        return [
            { title: "Break UI into components", done: false },
            { title: "Connect state handling", done: false },
            { title: "Review render behavior", done: false }
        ];
    }

    if (value.includes("statistics") || value.includes("analytics")) {
        return [
            { title: "Choose chart structure", done: false },
            { title: "Bind data points", done: false },
            { title: "Polish insight copy", done: false }
        ];
    }

    if (value.includes("task")) {
        return [
            { title: "Define the next action", done: false },
            { title: "Execute the main step", done: false },
            { title: "Review the outcome", done: false }
        ];
    }

    return [
        { title: "Plan the scope", done: false },
        { title: "Build the first pass", done: false },
        { title: "Review and polish", done: false }
    ];
}

function createTask(title, priority, dueDate) {
    const now = new Date().toISOString();
    const task = normalizeTask({
        id: `task-${Date.now()}`,
        title,
        priority,
        custom: true,
        status: "pending",
        reason: "",
        dueDate: normalizeDateInput(dueDate) || suggestDueDate(priority),
        subtasks: generateSubtasks(title),
        history: [
            { action: "created", note: `Task "${title}" was created with 3 smart subtasks.`, at: now }
        ],
        createdAt: now,
        updatedAt: now
    }, 0);

    return task;
}

function getTaskStats(tasks) {
    const total = tasks.length;
    const completed = tasks.filter((task) => task.status === "completed").length;
    const pending = tasks.filter((task) => task.status === "pending").length;
    const inProgress = tasks.filter((task) => task.status === "in_progress").length;
    const blocked = tasks.filter((task) => task.status === "blocked").length;
    const skipped = tasks.filter((task) => task.status === "skipped").length;
    const cancelled = tasks.filter((task) => task.status === "cancelled").length;
    const open = tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length;
    const custom = tasks.filter((task) => task.custom).length;
    const high = tasks.filter((task) => task.priority === "high").length;
    const medium = tasks.filter((task) => task.priority === "medium").length;
    const low = tasks.filter((task) => task.priority === "low").length;
    const totalSubtasks = tasks.reduce((sum, task) => sum + task.subtasks.length, 0);
    const completedSubtasks = tasks.reduce(
        (sum, task) => sum + task.subtasks.filter((subtask) => subtask.done).length,
        0
    );
    const completionRate = totalSubtasks === 0 ? 0 : Math.round((completedSubtasks / totalSubtasks) * 100);
    const averageProgress = total === 0
        ? 0
        : Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / total);
    const overdue = tasks.filter((task) => isTaskOverdue(task)).length;
    const dueToday = tasks.filter((task) => isTaskDueToday(task)).length;
    const completionThisWeek = getActivityLog().filter((entry) => (
        entry.action === "completed" && isDateWithinLastDays(entry.at, 7)
    )).length;

    return {
        total,
        completed,
        pending,
        inProgress,
        blocked,
        skipped,
        cancelled,
        open,
        custom,
        high,
        medium,
        low,
        totalSubtasks,
        completedSubtasks,
        completionRate,
        averageProgress,
        overdue,
        dueToday,
        completionThisWeek
    };
}

function getPriorityMeta(priority) {
    if (priority === "high") return { label: "High", className: "high" };
    if (priority === "low") return { label: "Low", className: "low" };
    return { label: "Medium", className: "medium" };
}

function getStatusMeta(status) {
    if (status === "completed") return { label: "Completed", className: "completed", tone: "cyan" };
    if (status === "in_progress") return { label: "In Progress", className: "in-progress", tone: "blue" };
    if (status === "blocked") return { label: "Blocked", className: "blocked", tone: "red" };
    if (status === "skipped") return { label: "Skipped", className: "skipped", tone: "amber" };
    if (status === "cancelled") return { label: "Cancelled", className: "cancelled", tone: "red" };
    return { label: "Pending", className: "pending", tone: "cyan" };
}

function getActivityMeta(action) {
    const map = {
        created: { label: "Created", className: "created" },
        updated: { label: "Updated", className: "updated" },
        blocked: { label: "Blocked", className: "blocked" },
        skipped: { label: "Skipped", className: "skipped" },
        cancelled: { label: "Cancelled", className: "cancelled" },
        completed: { label: "Completed", className: "completed" },
        deleted: { label: "Deleted", className: "deleted" },
        resumed: { label: "Resumed", className: "resumed" },
        reopened: { label: "Reopened", className: "reopened" }
    };

    return map[action] || map.updated;
}

function getTaskCategory(task) {
    return task.custom ? "Custom lane" : "Core lane";
}

function getPriorityWeight(priority) {
    if (priority === "high") return 3;
    if (priority === "medium") return 2;
    return 1;
}

function getDueUrgency(task) {
    if (isTaskOverdue(task)) return 3;
    if (isTaskDueToday(task)) return 2;
    if (isTaskDueTomorrow(task)) return 1;
    return 0;
}

function getNextFocusTask(tasks) {
    const statusWeight = {
        pending: 4,
        in_progress: 3,
        blocked: 2,
        skipped: 1,
        cancelled: 0,
        completed: -1
    };

    const focusable = tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");

    return [...focusable].sort((a, b) => {
        const dueDiff = getDueUrgency(b) - getDueUrgency(a);
        if (dueDiff !== 0) {
            return dueDiff;
        }

        const statusDiff = (statusWeight[b.status] || 0) - (statusWeight[a.status] || 0);
        if (statusDiff !== 0) {
            return statusDiff;
        }

        const priorityDiff = getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        return a.progress - b.progress;
    })[0] || null;
}

function filterTasks(tasks, filter) {
    if (filter === "active") {
        return tasks.filter((task) => ["pending", "in_progress"].includes(task.status));
    }

    if (filter === "completed") {
        return tasks.filter((task) => task.status === "completed");
    }

    if (filter === "blocked") {
        return tasks.filter((task) => task.status === "blocked");
    }

    if (filter === "skipped") {
        return tasks.filter((task) => task.status === "skipped");
    }

    if (filter === "cancelled") {
        return tasks.filter((task) => task.status === "cancelled");
    }

    if (filter === "custom") {
        return tasks.filter((task) => task.custom);
    }

    return tasks;
}

function searchTasks(tasks, query) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return tasks;
    }

    return tasks.filter((task) => (
        task.title.toLowerCase().includes(normalizedQuery) ||
        task.subtasks.some((subtask) => subtask.title.toLowerCase().includes(normalizedQuery)) ||
        (task.reason || "").toLowerCase().includes(normalizedQuery)
    ));
}

function sortTasks(tasks, sortKey) {
    const sorted = tasks.slice();

    sorted.sort((a, b) => {
        if (sortKey === "priority") {
            const priorityDiff = getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }
        }

        if (sortKey === "updated") {
            const updatedDiff = new Date(b.updatedAt) - new Date(a.updatedAt);
            if (updatedDiff !== 0) {
                return updatedDiff;
            }
        }

        if (sortKey === "progress") {
            const progressDiff = b.progress - a.progress;
            if (progressDiff !== 0) {
                return progressDiff;
            }
        }

        if (sortKey === "title") {
            const titleDiff = a.title.localeCompare(b.title);
            if (titleDiff !== 0) {
                return titleDiff;
            }
        }

        const urgencyDiff = getDueUrgency(b) - getDueUrgency(a);
        if (urgencyDiff !== 0) {
            return urgencyDiff;
        }

        const dateDiff = compareDueDates(a.dueDate, b.dueDate);
        if (dateDiff !== 0) {
            return dateDiff;
        }

        return getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
    });

    return sorted;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function buildWeeklyTrendData(stats) {
    const base = clamp(stats.averageProgress, 12, 88);
    const offsets = [-16, -10, -4, 6, 12, 18, 10];
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    return labels.map((label, index) => ({
        label,
        value: clamp(base + offsets[index] + (stats.completed * 2) - stats.blocked - stats.overdue + stats.inProgress, 14, 96)
    }));
}

function createTrendSvg(points) {
    const width = 580;
    const height = 220;
    const paddingX = 24;
    const paddingY = 18;
    const graphWidth = width - (paddingX * 2);
    const graphHeight = height - (paddingY * 2);

    const mapped = points.map((point, index) => {
        const x = paddingX + ((graphWidth / (points.length - 1 || 1)) * index);
        const y = height - paddingY - ((point.value / 100) * graphHeight);
        return { ...point, x, y };
    });

    const linePath = mapped.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const areaPath = `${linePath} L ${mapped[mapped.length - 1].x} ${height - paddingY} L ${mapped[0].x} ${height - paddingY} Z`;
    const guides = [25, 50, 75].map((value) => {
        const y = height - paddingY - ((value / 100) * graphHeight);
        return `<line x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}" class="trend-grid-line"></line>`;
    }).join("");
    const circles = mapped
        .map((point) => `<circle cx="${point.x}" cy="${point.y}" r="5.5" class="trend-point"></circle>`)
        .join("");
    const labels = mapped.map((point) => `<span>${point.label}</span>`).join("");

    return `
        <svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="Weekly momentum chart">
            ${guides}
            <path d="${areaPath}" class="trend-area"></path>
            <path d="${linePath}" class="trend-line"></path>
            ${circles}
        </svg>
        <div class="trend-label-row">${labels}</div>
    `;
}

function pluralizeTasks(count) {
    return `${count} task${count === 1 ? "" : "s"}`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderAllViews() {
    renderHomePage();
    renderStatisticsPage();
    renderTasksPage();
    renderProgressPage();
    renderAdminPage();
}

function renderHomePage() {
    const overview = document.getElementById("homeOverview");
    const preview = document.getElementById("homeTaskPreview");

    if (!overview || !preview) {
        return;
    }

    const activityFeed = document.getElementById("homeActivityFeed");
    const executiveInsights = document.getElementById("homeExecutiveInsights");
    const tasks = getTasks();
    const stats = getTaskStats(tasks);
    const focusTask = getNextFocusTask(tasks);
    const syntheticStreak = Math.max(4, stats.completed + stats.inProgress + 2);
    const velocity = Math.max(3, stats.completedSubtasks);

    setText("homeCompletedCount", stats.completed);
    setText("homePendingCount", stats.open);
    setText("heroStreakValue", `${syntheticStreak} days`);
    setText("heroVelocityValue", `${velocity} wins`);
    setText("heroFocusRateValue", `${stats.averageProgress}%`);
    setText("heroStageCompletion", `${stats.completionRate}%`);
    setText("heroStagePending", stats.open);
    setText("heroStageCustom", stats.custom);

    if (focusTask) {
        const status = getStatusMeta(focusTask.status);
        const dueMeta = getDueMeta(focusTask);
        setText("heroFocusTitle", focusTask.title);
        setText("heroFocusMeta", `${status.label} - ${focusTask.progress}% complete - ${dueMeta.label}`);
    }

    const cards = [
        {
            label: "Overdue tasks",
            value: `${stats.overdue}`,
            note: stats.overdue ? "Immediate deadline pressure is active." : "No task is past its deadline.",
            tone: stats.overdue ? "critical" : "calm"
        },
        {
            label: "Tasks due today",
            value: `${stats.dueToday}`,
            note: stats.dueToday ? "These items should close before day-end." : "No deadline expires today.",
            tone: stats.dueToday ? "focus" : "calm"
        },
        {
            label: "Blocked tasks",
            value: `${stats.blocked}`,
            note: stats.blocked ? "These tasks need an unblock decision." : "No blocked items are waiting.",
            tone: stats.blocked ? "critical" : "calm"
        },
        {
            label: "Completion this week",
            value: `${stats.completionThisWeek}`,
            note: "Based on recorded completion activity in the last 7 days.",
            tone: "progress"
        }
    ];

    overview.innerHTML = cards
        .map((card) => `
            <article class="metric-card tone-${card.tone}">
                <span>${card.label}</span>
                <strong>${card.value}</strong>
                <small>${card.note}</small>
            </article>
        `)
        .join("");

    if (activityFeed) {
        const recentActivity = getRecentActivity(5);
        activityFeed.innerHTML = recentActivity.length
            ? recentActivity.map((entry) => renderActivityFeedItem(entry)).join("")
            : `<div class="empty-state">Activity will appear here as you create, edit, complete, or delete tasks.</div>`;
    }

    if (executiveInsights) {
        executiveInsights.innerHTML = getExecutiveInsights(tasks, stats)
            .map((insight) => `
                <article class="insight-card tone-${insight.tone}">
                    <strong>${escapeHtml(insight.title)}</strong>
                    <span>${escapeHtml(insight.body)}</span>
                </article>
            `)
            .join("");
    }

    preview.innerHTML = tasks
        .slice()
        .sort((a, b) => {
            const aClosed = ["completed", "cancelled"].includes(a.status);
            const bClosed = ["completed", "cancelled"].includes(b.status);
            if (aClosed !== bClosed) {
                return Number(aClosed) - Number(bClosed);
            }

            const dueDiff = getDueUrgency(b) - getDueUrgency(a);
            if (dueDiff !== 0) {
                return dueDiff;
            }

            return getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
        })
        .slice(0, 4)
        .map((task) => {
            const priority = getPriorityMeta(task.priority);
            const status = getStatusMeta(task.status);
            const dueMeta = getDueMeta(task);
            return `
                <article class="stack-item">
                    <div>
                        <strong>${escapeHtml(task.title)}</strong>
                        <span>${status.label} - ${task.progress}% complete - ${dueMeta.label}</span>
                    </div>
                    <span class="priority-badge ${priority.className}">${priority.label}</span>
                </article>
            `;
        })
        .join("");
}

function renderStatisticsPage() {
    const statsCards = document.getElementById("statsCards");
    const weeklyBars = document.getElementById("weeklyBars");
    const breakdown = document.getElementById("priorityBreakdown");
    const tableBody = document.getElementById("statsTableBody");

    if (!statsCards || !weeklyBars || !breakdown) {
        return;
    }

    const tasks = getTasks();
    const stats = getTaskStats(tasks);
    const trendData = buildWeeklyTrendData(stats);
    const recentActivity = getRecentActivity(1)[0];
    const statsExecutiveInsights = document.getElementById("statsExecutiveInsights");

    const cards = [
        { label: "Completed Tasks", value: `${stats.completed}`, note: `${stats.open} items remain active`, tone: "cyan" },
        { label: "Overdue Tasks", value: `${stats.overdue}`, note: stats.overdue ? "Past due and still open" : "No overdue backlog", tone: "red" },
        { label: "Due Today", value: `${stats.dueToday}`, note: "Short-term delivery pressure", tone: "amber" },
        { label: "Completion This Week", value: `${stats.completionThisWeek}`, note: "Tracked from activity history", tone: "green" }
    ];

    statsCards.innerHTML = cards
        .map((card) => `
            <article class="stats-card tone-${card.tone}">
                <span>${card.label}</span>
                <strong>${card.value}</strong>
                <small>${card.note}</small>
            </article>
        `)
        .join("");

    const trendChart = document.getElementById("trendChart");
    const trendHeadline = document.getElementById("trendHeadline");
    const trendSubline = document.getElementById("trendSubline");
    if (trendChart && trendHeadline && trendSubline) {
        trendChart.innerHTML = createTrendSvg(trendData);
        trendHeadline.textContent = `${stats.averageProgress}%`;
        trendSubline.textContent = `${stats.completedSubtasks}/${stats.totalSubtasks} subtasks are complete. ${stats.dueToday} due today and ${stats.overdue} overdue.`;
    }

    const donut = document.getElementById("priorityDonut");
    const donutCenterValue = document.getElementById("donutCenterValue");
    const priorityLegend = document.getElementById("priorityLegend");
    const total = Math.max(stats.total, 1);
    const highPercent = Math.round((stats.high / total) * 100);
    const mediumPercent = Math.round((stats.medium / total) * 100);

    if (donut && donutCenterValue && priorityLegend) {
        donut.style.background = `conic-gradient(
            #ff6c7a 0 ${highPercent}%,
            #39d0ff ${highPercent}% ${highPercent + mediumPercent}%,
            #4ade80 ${highPercent + mediumPercent}% 100%
        )`;
        donutCenterValue.textContent = `${highPercent}%`;
        priorityLegend.innerHTML = [
            { label: "High priority", value: pluralizeTasks(stats.high), swatch: "high" },
            { label: "Medium priority", value: pluralizeTasks(stats.medium), swatch: "medium" },
            { label: "Low priority", value: pluralizeTasks(stats.low), swatch: "low" }
        ]
            .map((item) => `
                <article class="legend-item">
                    <span class="legend-swatch ${item.swatch}"></span>
                    <div>
                        <strong>${item.label}</strong>
                        <span>${item.value}</span>
                    </div>
                </article>
            `)
            .join("");
    }

    weeklyBars.innerHTML = trendData
        .map((point) => `
            <div class="bar">
                <div class="bar-track">
                    <div class="bar-fill" style="height:${point.value}%"></div>
                </div>
                <span>${point.label}</span>
            </div>
        `)
        .join("");

    const statusBreakdown = [
        {
            label: "In Progress",
            value: stats.inProgress,
            className: "medium",
            note: `${pluralizeTasks(stats.pending)} ${stats.pending === 1 ? "has" : "have"} not started yet.`
        },
        {
            label: "Deadline Pressure",
            value: `${stats.overdue}/${stats.dueToday}`,
            className: "high",
            note: "Overdue / due today split for the active board."
        },
        {
            label: "Weekly Wins",
            value: stats.completionThisWeek,
            className: "low",
            note: "Completion events logged in the last 7 days."
        },
        {
            label: "Latest Activity",
            value: recentActivity ? getActivityMeta(recentActivity.action).label : "Quiet",
            className: "medium",
            note: recentActivity
                ? `${recentActivity.taskTitle} - ${recentActivity.note}`
                : "No recent activity has been recorded yet."
        }
    ];

    breakdown.innerHTML = statusBreakdown
        .map((item) => `
            <article class="stack-item">
                <div>
                    <strong>${item.label}</strong>
                    <span>${escapeHtml(item.note)}</span>
                </div>
                <span class="priority-badge ${item.className}">${escapeHtml(item.value)}</span>
            </article>
        `)
        .join("");

    if (statsExecutiveInsights) {
        statsExecutiveInsights.innerHTML = getExecutiveInsights(tasks, stats, "analytics")
            .map((insight) => `
                <article class="insight-card tone-${insight.tone}">
                    <strong>${escapeHtml(insight.title)}</strong>
                    <span>${escapeHtml(insight.body)}</span>
                </article>
            `)
            .join("");
    }

    if (tableBody) {
        const sortedTasks = tasks
            .slice()
            .sort((a, b) => {
                const urgency = getDueUrgency(b) - getDueUrgency(a);
                if (urgency !== 0) {
                    return urgency;
                }

                return getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
            });

        tableBody.innerHTML = sortedTasks
            .map((task) => {
                const priority = getPriorityMeta(task.priority);
                const status = getStatusMeta(task.status);
                const dueMeta = getDueMeta(task);
                return `
                    <tr>
                        <td><strong>${escapeHtml(task.title)}</strong></td>
                        <td><span class="table-pill ${priority.className}">${priority.label}</span></td>
                        <td><span class="table-pill status ${status.className}">${status.label}</span></td>
                        <td>${escapeHtml(dueMeta.label)}</td>
                        <td>${task.progress}%</td>
                    </tr>
                `;
            })
            .join("");
    }
}

function renderTasksPage() {
    const container = document.getElementById("tasksContainer");
    const filters = document.getElementById("taskFilters");
    const insights = document.getElementById("taskInsightRow");
    const searchInput = document.getElementById("taskSearchInput");
    const sortSelect = document.getElementById("taskSortSelect");

    if (!container || !filters || !insights) {
        return;
    }

    const tasks = getTasks();
    const stats = getTaskStats(tasks);
    const filteredTasks = sortTasks(
        searchTasks(filterTasks(tasks, UI_STATE.taskFilter), UI_STATE.taskSearch),
        UI_STATE.taskSort
    );
    const focusTask = getNextFocusTask(tasks);

    setText("taskSummaryTotal", stats.total);
    setText("taskSummaryDone", stats.completed);
    setText("taskSummaryPending", stats.open);
    setText("taskCounter", `${filteredTasks.length} visible - ${stats.overdue} overdue - sorted by ${formatSortLabel(UI_STATE.taskSort)}`);

    const filterDefinitions = [
        { id: "all", label: "All Tasks", count: stats.total },
        { id: "active", label: "Active", count: stats.pending + stats.inProgress },
        { id: "completed", label: "Completed", count: stats.completed },
        { id: "blocked", label: "Blocked", count: stats.blocked },
        { id: "skipped", label: "Skipped", count: stats.skipped },
        { id: "cancelled", label: "Cancelled", count: stats.cancelled },
        { id: "custom", label: "Custom", count: stats.custom }
    ];

    filters.innerHTML = filterDefinitions
        .map((filter) => `
            <button class="filter-chip ${UI_STATE.taskFilter === filter.id ? "active" : ""}" type="button" data-filter="${filter.id}">
                <span>${filter.label}</span>
                <strong>${filter.count}</strong>
            </button>
        `)
        .join("");

    filters.querySelectorAll("[data-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            UI_STATE.taskFilter = button.dataset.filter;
            renderTasksPage();
        });
    });

    if (searchInput) {
        searchInput.value = UI_STATE.taskSearch;
        searchInput.oninput = (event) => {
            UI_STATE.taskSearch = event.target.value;
            renderTasksPage();
        };
    }

    if (sortSelect) {
        sortSelect.value = UI_STATE.taskSort;
        sortSelect.onchange = (event) => {
            UI_STATE.taskSort = event.target.value;
            renderTasksPage();
        };
    }

    insights.innerHTML = [
        {
            label: "Focus lane",
            value: focusTask ? focusTask.title : "No active focus",
            note: focusTask ? `${getStatusMeta(focusTask.status).label} - ${getRiskMeta(focusTask).label}` : "Everything is closed"
        },
        {
            label: "Due today",
            value: `${stats.dueToday}`,
            note: stats.dueToday ? "Work to land before the day ends." : "No task expires today."
        },
        {
            label: "Overdue",
            value: `${stats.overdue}`,
            note: stats.overdue ? "These tasks need immediate attention." : "No missed deadlines."
        },
        {
            label: "Completion this week",
            value: `${stats.completionThisWeek}`,
            note: `${stats.completedSubtasks}/${stats.totalSubtasks} subtasks closed across the board.`
        },
        {
            label: "Search scope",
            value: UI_STATE.taskSearch ? `"${UI_STATE.taskSearch}"` : "Full board",
            note: `Sorted by ${formatSortLabel(UI_STATE.taskSort)}`
        }
    ]
        .map((item) => `
            <article class="task-insight-card">
                <span>${item.label}</span>
                <strong>${escapeHtml(item.value)}</strong>
                <small>${item.note}</small>
            </article>
        `)
        .join("");

    if (!filteredTasks.length) {
        container.innerHTML = `<div class="empty-state">No tasks match the selected filter right now.</div>`;
        return;
    }

    container.innerHTML = filteredTasks.map((task) => renderTaskCard(task)).join("");

    container.querySelectorAll("[data-subtask-task]").forEach((checkbox) => {
        checkbox.addEventListener("change", (event) => {
            toggleSubtask(
                event.target.dataset.subtaskTask,
                event.target.dataset.subtaskId,
                event.target.checked
            );
        });
    });

    container.querySelectorAll("[data-task-action]").forEach((button) => {
        button.addEventListener("click", () => {
            handleTaskAction(button.dataset.taskAction, button.dataset.taskId);
        });
    });
}

function renderTaskCard(task) {
    const priority = getPriorityMeta(task.priority);
    const status = getStatusMeta(task.status);
    const dueMeta = getDueMeta(task);
    const riskMeta = getRiskMeta(task);
    const reasonBlock = task.reason
        ? `<div class="task-reason"><strong>Reason</strong><span>${escapeHtml(task.reason)}</span></div>`
        : "";
    const recentHistory = task.history.slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 3);

    return `
        <article class="task-row interactive is-${status.className}">
            <div class="task-card-top">
                <div class="task-row-main">
                    <div class="task-content">
                        <div class="task-headline">
                            <strong>${escapeHtml(task.title)}</strong>
                            <span class="task-type-pill">${task.custom ? "Custom" : "Core"}</span>
                        </div>
                        <span>${getTaskCategory(task)} - ${task.subtasks.length} smart subtasks</span>
                    </div>
                </div>
                <div class="task-row-side">
                    <span class="priority-badge ${priority.className}">${priority.label}</span>
                    <span class="task-status status-${status.className}">${status.label}</span>
                </div>
            </div>

            <div class="task-detail-row">
                <span class="deadline-pill ${dueMeta.className}">${escapeHtml(dueMeta.label)}</span>
                <span class="risk-pill tone-${riskMeta.tone}">${escapeHtml(riskMeta.label)}</span>
                <span class="task-detail-chip">Updated ${escapeHtml(formatDateTime(task.updatedAt))}</span>
            </div>

            <div class="task-progress">
                <div class="task-progress-head">
                    <span>Progress</span>
                    <strong>${task.progress}%</strong>
                </div>
                <div class="progress-track">
                    <div class="progress-fill ${status.tone}" style="width:${task.progress}%"></div>
                </div>
            </div>

            ${reasonBlock}

            <div class="subtask-list">
                ${task.subtasks.map((subtask) => `
                    <label class="subtask-item">
                        <input
                            type="checkbox"
                            data-subtask-task="${task.id}"
                            data-subtask-id="${subtask.id}"
                            ${subtask.done ? "checked" : ""}
                        >
                        <div class="subtask-copy">
                            <strong>${escapeHtml(subtask.title)}</strong>
                            <span>${subtask.done ? "Completed" : "Open step"}</span>
                        </div>
                    </label>
                `).join("")}
            </div>

            <div class="activity-list">
                <div class="activity-list-head">
                    <strong>Recent activity</strong>
                    <span>${task.history.length} events</span>
                </div>
                ${recentHistory.map((entry) => renderTaskHistoryItem(entry)).join("")}
            </div>

            <div class="task-actions">
                ${task.status === "completed"
                    ? `<button class="action-button ghost" type="button" data-task-action="reset" data-task-id="${task.id}">Reopen</button>`
                    : `<button class="action-button primary" type="button" data-task-action="complete" data-task-id="${task.id}">Complete All</button>`
                }
                ${task.status === "completed"
                    ? ""
                    : ["blocked", "skipped", "cancelled"].includes(task.status)
                    ? `<button class="action-button ghost" type="button" data-task-action="resume" data-task-id="${task.id}">Resume</button>`
                    : `
                        <button class="action-button ghost" type="button" data-task-action="skip" data-task-id="${task.id}">Skip</button>
                        <button class="action-button ghost" type="button" data-task-action="block" data-task-id="${task.id}">Block</button>
                        <button class="action-button ghost" type="button" data-task-action="cancel" data-task-id="${task.id}">Cancel</button>
                    `
                }
                <button class="action-button ghost" type="button" data-task-action="edit" data-task-id="${task.id}">Edit</button>
                <button class="action-button danger" type="button" data-task-action="delete" data-task-id="${task.id}">Delete</button>
            </div>
        </article>
    `;
}

function renderTaskHistoryItem(entry) {
    const meta = getActivityMeta(entry.action);

    return `
        <article class="activity-item">
            <span class="activity-dot ${meta.className}"></span>
            <div class="activity-copy">
                <strong>${meta.label}</strong>
                <span>${escapeHtml(entry.note)}</span>
            </div>
            <time class="activity-time">${escapeHtml(formatDateTime(entry.at))}</time>
        </article>
    `;
}

function renderActivityFeedItem(entry) {
    const meta = getActivityMeta(entry.action);

    return `
        <article class="activity-feed-item">
            <div class="activity-feed-top">
                <span class="deadline-pill neutral">${meta.label}</span>
                <time>${escapeHtml(formatDateTime(entry.at))}</time>
            </div>
            <strong>${escapeHtml(entry.taskTitle)}</strong>
            <span>${escapeHtml(entry.note)}</span>
        </article>
    `;
}

function getExecutiveInsights(tasks, stats, mode = "home") {
    const focusTask = getNextFocusTask(tasks);
    const insights = [];

    if (stats.overdue > 0) {
        insights.push({
            title: "Deadline pressure is active",
            body: `${stats.overdue} task${stats.overdue === 1 ? " is" : "s are"} overdue, so the board needs immediate recovery attention.`,
            tone: "critical"
        });
    } else {
        insights.push({
            title: "Deadline health is stable",
            body: "No active task is overdue right now, which keeps delivery risk under control.",
            tone: "calm"
        });
    }

    if (stats.blocked > 0) {
        insights.push({
            title: "Blocked work is slowing momentum",
            body: `${stats.blocked} blocked item${stats.blocked === 1 ? "" : "s"} should be unblocked before starting new work.`,
            tone: "focus"
        });
    } else {
        insights.push({
            title: "Execution flow is clean",
            body: "There are no blocked tasks at the moment, so the team can stay focused on delivery.",
            tone: "progress"
        });
    }

    if (focusTask) {
        const risk = getRiskMeta(focusTask);
        insights.push({
            title: "Highest-value next move",
            body: `"${focusTask.title}" is the best next focus because it is ${risk.label.toLowerCase()} and currently at ${focusTask.progress}% progress.`,
            tone: risk.tone
        });
    }

    if (mode === "analytics") {
        insights.push({
            title: "Weekly completion signal",
            body: `${stats.completionThisWeek} task completion event${stats.completionThisWeek === 1 ? "" : "s"} were logged in the last 7 days, with ${stats.completionRate}% subtask completion overall.`,
            tone: stats.completionRate >= 65 ? "progress" : "focus"
        });
    }

    return insights.slice(0, 4);
}

function toggleSubtask(taskId, subtaskId, checked) {
    updateTask(taskId, (task) => {
        const subtasks = task.subtasks.map((subtask) => (
            subtask.id === subtaskId
                ? { ...subtask, done: checked }
                : subtask
        ));

        const automaticStatus = deriveTaskStatus(subtasks, null);

        return {
            ...task,
            subtasks,
            status: automaticStatus,
            reason: "",
            updatedAt: new Date().toISOString()
        };
    }, (before, after) => {
        const subtask = after.subtasks.find((item) => item.id === subtaskId);
        const note = checked
            ? `Completed subtask: ${subtask ? subtask.title : "Subtask"}`
            : `Reopened subtask: ${subtask ? subtask.title : "Subtask"}`;
        const action = after.status === "completed" ? "completed" : "updated";

        return { action, note };
    });

    showToast(checked ? "Subtask marked as completed." : "Subtask reopened for follow-up.", checked ? "success" : "info");
}

function handleTaskAction(action, taskId) {
    if (action === "edit") {
        openTaskEditor(taskId);
        return;
    }

    if (action === "delete") {
        const task = getTasks().find((item) => item.id === taskId);
        if (!task) {
            return;
        }

        if (!window.confirm("Do you want to permanently remove this task?")) {
            return;
        }

        pushActivityLogEntry(task, "deleted", `Task "${task.title}" was removed from the board.`);
        saveTasks(getTasks().filter((item) => item.id !== taskId));
        renderAllViews();
        showToast(`"${task.title}" was removed from the board.`, "danger");
        return;
    }

    if (action === "complete") {
        updateTask(taskId, (task) => ({
            ...task,
            subtasks: task.subtasks.map((subtask) => ({ ...subtask, done: true })),
            status: "completed",
            reason: "",
            updatedAt: new Date().toISOString()
        }), () => ({
            action: "completed",
            note: "Marked the full task as completed."
        }));
        showToast("Task marked as completed.", "success");
        return;
    }

    if (action === "resume") {
        updateTask(taskId, (task) => ({
            ...task,
            status: deriveTaskStatus(task.subtasks, null),
            reason: "",
            updatedAt: new Date().toISOString()
        }), () => ({
            action: "resumed",
            note: "Returned the task to the active workflow."
        }));
        showToast("Task returned to the active workflow.", "info");
        return;
    }

    if (action === "reset") {
        updateTask(taskId, (task) => ({
            ...task,
            subtasks: task.subtasks.map((subtask) => ({ ...subtask, done: false })),
            status: "pending",
            reason: "",
            updatedAt: new Date().toISOString()
        }), () => ({
            action: "reopened",
            note: "Reopened the task and cleared all subtasks."
        }));
        showToast("Task reopened and subtasks reset.", "info");
        return;
    }

    if (["skip", "block", "cancel"].includes(action)) {
        const labels = {
            skip: "skipped",
            block: "blocked",
            cancel: "cancelled"
        };
        const reason = window.prompt(`Add a short reason for marking this task as ${labels[action]}.`, "");

        if (reason === null) {
            return;
        }

        updateTask(taskId, (task) => ({
            ...task,
            status: labels[action],
            reason: reason.trim() || `Marked as ${labels[action]}.`,
            updatedAt: new Date().toISOString()
        }), (before, after) => ({
            action: labels[action],
            note: after.reason || `Marked as ${labels[action]}.`
        }));
        showToast(`Task marked as ${labels[action]}.`, action === "block" ? "warning" : "info");
    }
}

function updateTask(taskId, updater, activityBuilder) {
    const tasks = getTasks();
    let changed = false;

    const nextTasks = tasks.map((task) => {
        if (task.id !== taskId) {
            return task;
        }

        changed = true;
        const nextDraft = updater(task);
        const activities = toActivityArray(activityBuilder ? activityBuilder(task, nextDraft) : null);
        let nextTask = { ...nextDraft };

        activities.forEach((activity) => {
            nextTask = appendTaskActivity(nextTask, activity.action, activity.note, activity.at);
        });

        return normalizeTask(nextTask, 0);
    });

    if (!changed) {
        return;
    }

    saveTasks(nextTasks);
    renderAllViews();
}

function toActivityArray(activity) {
    if (!activity) {
        return [];
    }

    return (Array.isArray(activity) ? activity : [activity])
        .filter(Boolean)
        .map((item) => ({
            action: normalizeActivityAction(item.action),
            note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : "Task updated.",
            at: item.at || new Date().toISOString()
        }));
}

function appendTaskActivity(task, action, note, at = new Date().toISOString()) {
    const history = normalizeTaskHistory(task.history, task.title, task.createdAt, task.id);
    const nextTask = {
        ...task,
        history: [...history, {
            id: `${task.id}-history-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            action,
            note,
            at
        }].slice(-MAX_TASK_HISTORY),
        updatedAt: at
    };

    pushActivityLogEntry(nextTask, action, note, at);
    return nextTask;
}

function pushActivityLogEntry(task, action, note, at = new Date().toISOString()) {
    const log = getActivityLog();
    log.push(normalizeActivityEntry({
        taskId: task.id,
        taskTitle: task.title,
        action,
        note,
        at,
        priority: task.priority,
        dueDate: task.dueDate
    }));
    saveActivityLog(log);
}

function renderProgressPage() {
    const skillList = document.getElementById("skillProgressList");
    const customList = document.getElementById("customProgressList");

    if (!skillList || !customList) {
        return;
    }

    const tasks = getTasks();
    const stats = getTaskStats(tasks);

    setText("overallProgressLabel", `Overall completion: ${stats.completionRate}%`);

    const overallBar = document.getElementById("overallProgressBar");
    if (overallBar) {
        overallBar.style.width = `${stats.completionRate}%`;
    }

    skillList.innerHTML = SKILL_PROGRESS
        .map((item) => renderProgressItem(item.title, item.percent, item.tone, "Core learning track"))
        .join("");

    customList.innerHTML = tasks.length
        ? tasks
              .map((task) => {
                  const status = getStatusMeta(task.status);
                  const dueMeta = getDueMeta(task);
                  const note = task.reason
                      ? `${status.label} - ${task.reason} - ${dueMeta.label}`
                      : `${status.label} - ${task.subtasks.filter((subtask) => subtask.done).length}/${task.subtasks.length} subtasks done - ${dueMeta.label}`;
                  return renderProgressItem(task.title, task.progress, status.tone, note);
              })
              .join("")
        : `<div class="empty-state">Task progress will appear here.</div>`;

    attachProgressMedia();
}

function renderProgressItem(title, percent, tone, note) {
    return `
        <article class="progress-item">
            <div class="progress-copy">
                <strong>${escapeHtml(title)}</strong>
                <span>${percent}%</span>
            </div>
            <div class="progress-track">
                <div class="progress-fill ${tone}" style="width:${percent}%"></div>
            </div>
            <small class="progress-note">${escapeHtml(note)}</small>
        </article>
    `;
}

function attachProgressMedia() {
    const video = document.getElementById("progressDemoVideo");
    const audio = document.getElementById("progressDemoAudio");

    if (audio) {
        if (!MEDIA_STATE.audioUrl) {
            const audioBlob = generateDashboardAudioBlob();
            MEDIA_STATE.audioUrl = URL.createObjectURL(audioBlob);
        }

        if (audio.src !== MEDIA_STATE.audioUrl) {
            audio.src = MEDIA_STATE.audioUrl;
        }

        setText("progressAudioCaption", "Local dashboard audio cue is ready for playback, and click feedback is active across the interface.");
    }

    if (!video) {
        return;
    }

    if (MEDIA_STATE.videoUrl) {
        if (video.src !== MEDIA_STATE.videoUrl) {
            video.src = MEDIA_STATE.videoUrl;
        }
        setText("progressVideoCaption", "Local multi-page walkthrough clip is ready for playback.");
        return;
    }

    if (!MEDIA_STATE.videoPromise) {
        setText("progressVideoCaption", "Generating a multi-page walkthrough clip that highlights every dashboard section...");
        MEDIA_STATE.videoPromise = generateDashboardVideo().then((url) => {
            MEDIA_STATE.videoUrl = url;
            return url;
        }).catch(() => "");
    }

    MEDIA_STATE.videoPromise.then((url) => {
        if (url) {
            if (video.src !== url) {
                video.src = url;
            }
            setText("progressVideoCaption", "Local multi-page walkthrough clip is ready for playback.");
        } else {
            setText("progressVideoCaption", "Video generation is not supported in this browser session, but the video element is in place.");
        }
    });
}

function wireGlobalClickSound() {
    document.addEventListener("click", (event) => {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const interactiveTarget = target.closest(
            "a, button, input, select, textarea, label, summary, .filter-chip, .action-button, .subtask-item, .button"
        );

        if (!interactiveTarget) {
            return;
        }

        playClickSound();
    }, true);
}

function playClickSound() {
    const nowMs = Date.now();
    if (nowMs - MEDIA_STATE.clickLastTime < 45) {
        return;
    }
    MEDIA_STATE.clickLastTime = nowMs;

    const AudioContextRef = window.AudioContext || window.webkitAudioContext;

    if (AudioContextRef) {
        if (!MEDIA_STATE.clickContext) {
            try {
                MEDIA_STATE.clickContext = new AudioContextRef();
            } catch (error) {
                MEDIA_STATE.clickContext = null;
            }
        }

        if (MEDIA_STATE.clickContext) {
            if (MEDIA_STATE.clickContext.state === "suspended") {
                MEDIA_STATE.clickContext.resume().catch(() => {});
            }

            const context = MEDIA_STATE.clickContext;
            const oscillator = context.createOscillator();
            const gainNode = context.createGain();
            const now = context.currentTime;

            oscillator.type = "triangle";
            oscillator.frequency.setValueAtTime(820, now);
            oscillator.frequency.exponentialRampToValueAtTime(580, now + 0.08);

            gainNode.gain.setValueAtTime(0.0001, now);
            gainNode.gain.exponentialRampToValueAtTime(0.03, now + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

            oscillator.connect(gainNode);
            gainNode.connect(context.destination);
            oscillator.start(now);
            oscillator.stop(now + 0.12);
            return;
        }
    }

    if (!MEDIA_STATE.clickFallbackUrl) {
        const clickBlob = generateClickSoundBlob();
        MEDIA_STATE.clickFallbackUrl = URL.createObjectURL(clickBlob);
    }

    if (!MEDIA_STATE.clickFallbackAudio) {
        MEDIA_STATE.clickFallbackAudio = new Audio(MEDIA_STATE.clickFallbackUrl);
        MEDIA_STATE.clickFallbackAudio.preload = "auto";
    }

    MEDIA_STATE.clickFallbackAudio.currentTime = 0;
    MEDIA_STATE.clickFallbackAudio.play().catch(() => {});
}

function generateDashboardAudioBlob() {
    const sampleRate = 44100;
    const duration = 4.8;
    const totalSamples = Math.floor(sampleRate * duration);
    const samples = new Int16Array(totalSamples);
    const tones = [220, 277.18, 329.63, 392];

    for (let i = 0; i < totalSamples; i += 1) {
        const time = i / sampleRate;
        const segment = Math.min(tones.length - 1, Math.floor(time / 1.2));
        const envelope = Math.min(1, time * 3) * Math.max(0, 1 - ((time % 1.2) / 1.2) * 0.35);
        const wave = Math.sin(2 * Math.PI * tones[segment] * time) * 0.35;
        const pulse = Math.sin(2 * Math.PI * (tones[segment] / 2) * time) * 0.12;
        samples[i] = Math.max(-1, Math.min(1, (wave + pulse) * envelope)) * 32767;
    }

    return createWavBlob(samples, sampleRate);
}

function generateClickSoundBlob() {
    const sampleRate = 22050;
    const duration = 0.12;
    const totalSamples = Math.floor(sampleRate * duration);
    const samples = new Int16Array(totalSamples);

    for (let i = 0; i < totalSamples; i += 1) {
        const time = i / sampleRate;
        const envelope = Math.exp(-32 * time);
        const wave = (
            Math.sin(2 * Math.PI * 880 * time) * 0.5 +
            Math.sin(2 * Math.PI * 1320 * time) * 0.22
        );
        samples[i] = Math.max(-1, Math.min(1, wave * envelope)) * 32767;
    }

    return createWavBlob(samples, sampleRate);
}

function createWavBlob(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, samples.length * 2, true);

    for (let i = 0; i < samples.length; i += 1) {
        view.setInt16(44 + (i * 2), samples[i], true);
    }

    return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) {
        view.setUint8(offset + i, text.charCodeAt(i));
    }
}

async function generateDashboardVideo() {
    const canvas = document.createElement("canvas");
    const captureStream = canvas.captureStream || canvas.mozCaptureStream;

    if (!window.MediaRecorder || typeof captureStream !== "function") {
        return "";
    }

    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext("2d");
    if (!context) {
        return "";
    }

    const stream = captureStream.call(canvas, 12);
    const mimeCandidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    const mimeType = mimeCandidates.find((item) => (
        typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(item)
    )) || "";

    let recorder;
    try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        return "";
    }

    const chunks = [];

    return new Promise((resolve) => {
        const stopStream = () => {
            stream.getTracks().forEach((track) => track.stop());
        };

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size) {
                chunks.push(event.data);
            }
        };

        recorder.onerror = () => {
            stopStream();
            resolve("");
        };

        recorder.onstop = () => {
            stopStream();
            resolve(chunks.length ? URL.createObjectURL(new Blob(chunks, { type: mimeType || "video/webm" })) : "");
        };

        const totalFrames = 84;
        let frame = 0;

        drawDashboardVideoFrame(context, canvas, frame, totalFrames);
        recorder.start();

        const interval = window.setInterval(() => {
            frame += 1;
            drawDashboardVideoFrame(context, canvas, frame, totalFrames);

            if (frame >= totalFrames) {
                window.clearInterval(interval);
                window.setTimeout(() => {
                    if (recorder.state !== "inactive") {
                        recorder.stop();
                    }
                }, 180);
            }
        }, 95);
    });
}

function drawDashboardVideoFrame(context, canvas, frame, totalFrames) {
    const width = canvas.width;
    const height = canvas.height;
    const scenes = getVideoScenes();
    const framesPerScene = Math.max(1, Math.floor(totalFrames / scenes.length));
    const sceneIndex = Math.min(scenes.length - 1, Math.floor(frame / framesPerScene));
    const sceneFrame = frame - (sceneIndex * framesPerScene);
    const sceneProgress = clamp(sceneFrame / Math.max(framesPerScene - 1, 1), 0, 1);
    const overallProgress = frame / Math.max(totalFrames, 1);
    const scene = scenes[sceneIndex];
    const tasks = getTasks();
    const stats = getTaskStats(tasks);
    const focusTask = getNextFocusTask(tasks);

    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#071528");
    gradient.addColorStop(1, "#102847");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = "rgba(108, 233, 255, 0.08)";
    context.beginPath();
    context.arc(width * 0.82, height * 0.2, 120 + (overallProgress * 18), 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "rgba(248, 197, 110, 0.08)";
    context.beginPath();
    context.arc(width * 0.18, height * 0.82, 150 - (overallProgress * 12), 0, Math.PI * 2);
    context.fill();

    roundRect(context, 52, 48, width - 104, height - 96, 30, "rgba(9, 23, 42, 0.78)", "rgba(108, 233, 255, 0.14)");
    drawVideoSidebar(context, sceneIndex, width, height);
    roundRect(context, 368, 90, width * 0.5, 118, 24, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");
    roundRect(context, 368, 228, width * 0.5, height - 324, 24, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");

    context.fillStyle = "#6ce9ff";
    context.font = "700 18px Segoe UI";
    context.fillText("DEVELOPER DASHBOARD", 110, 132);

    context.fillStyle = "#ecf4ff";
    context.font = "700 30px Segoe UI";
    context.fillText(scene.title, 398, 132);

    context.fillStyle = "rgba(236, 244, 255, 0.7)";
    context.font = "500 16px Segoe UI";
    context.fillText(scene.subtitle, 398, 164);

    drawSceneBody(context, scene, sceneProgress, tasks, stats, focusTask);
    drawSceneFooter(context, sceneIndex, scenes.length, width, height);
}

function getVideoScenes() {
    return [
        {
            key: "login",
            navLabel: "Login",
            title: "Login Experience",
            subtitle: "The walkthrough begins with a clean sign-in gateway."
        },
        {
            key: "profile",
            navLabel: "Profile",
            title: "Profile Overview",
            subtitle: "Hero summary, focus metrics, and weekly momentum widgets."
        },
        {
            key: "statistics",
            navLabel: "Statistics",
            title: "Statistics Dashboard",
            subtitle: "Charts, ratios, and a structured execution table in one place."
        },
        {
            key: "tasks",
            navLabel: "Tasks",
            title: "Task Control Center",
            subtitle: "Deadlines, subtasks, edit flow, and activity history work together."
        },
        {
            key: "progress",
            navLabel: "Progress",
            title: "Progress Tracking",
            subtitle: "Skill bars, task completion, and media support for final delivery."
        },
        {
            key: "admin",
            navLabel: "Admin",
            title: "Admin Management",
            subtitle: "Create tasks, set deadlines, and monitor board-wide health."
        }
    ];
}

function drawVideoSidebar(context, sceneIndex, width, height) {
    roundRect(context, 88, 90, width * 0.24, height - 180, 24, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");

    const navItems = ["Profile", "Statistics", "Tasks", "Progress", "Admin"];
    context.fillStyle = "#dbe8f7";
    context.font = "700 22px Segoe UI";
    context.fillText("Workspace", 116, 188);

    navItems.forEach((label, index) => {
        const y = 238 + (index * 62);
        const isActive = sceneIndex > 0 && (index === sceneIndex - 1 || (sceneIndex === 5 && index === 4));
        roundRect(
            context,
            108,
            y - 28,
            184,
            42,
            18,
            isActive ? "rgba(57, 208, 255, 0.14)" : "rgba(255, 255, 255, 0.04)",
            isActive ? "rgba(57, 208, 255, 0.26)" : "rgba(255, 255, 255, 0.04)"
        );
        context.fillStyle = isActive ? "#ecf4ff" : "rgba(236, 244, 255, 0.72)";
        context.font = isActive ? "700 16px Segoe UI" : "600 16px Segoe UI";
        context.fillText(label, 128, y);
    });

    roundRect(context, 108, height - 186, 184, 94, 18, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");
    context.fillStyle = "#6ce9ff";
    context.font = "700 14px Segoe UI";
    context.fillText("FINAL DELIVERY", 126, height - 148);
    context.fillStyle = "rgba(236, 244, 255, 0.75)";
    context.font = "500 14px Segoe UI";
    context.fillText("Responsive, HTML-first,", 126, height - 120);
    context.fillText("and interaction-ready.", 126, height - 98);
}

function drawSceneBody(context, scene, sceneProgress, tasks, stats, focusTask) {
    if (scene.key === "login") {
        drawLoginScene(context, sceneProgress);
        return;
    }

    if (scene.key === "profile") {
        drawProfileScene(context, sceneProgress, stats, focusTask);
        return;
    }

    if (scene.key === "statistics") {
        drawStatisticsScene(context, sceneProgress, tasks, stats);
        return;
    }

    if (scene.key === "tasks") {
        drawTasksScene(context, sceneProgress, tasks);
        return;
    }

    if (scene.key === "progress") {
        drawProgressScene(context, sceneProgress, stats);
        return;
    }

    drawAdminScene(context, sceneProgress, stats);
}

function drawLoginScene(context, sceneProgress) {
    roundRect(context, 458, 254, 288, 176, 24, "rgba(7, 19, 35, 0.92)", "rgba(57, 208, 255, 0.18)");
    context.fillStyle = "#6ce9ff";
    context.font = "700 15px Segoe UI";
    context.fillText("WELCOME YOUR DASHBOARD", 486, 292);
    context.fillStyle = "#ecf4ff";
    context.font = "700 28px Segoe UI";
    context.fillText("Secure Login", 486, 332);

    ["Username", "Password"].forEach((label, index) => {
        const y = 352 + (index * 42);
        roundRect(context, 486, y, 228, 34, 12, "rgba(255, 255, 255, 0.05)", "rgba(255, 255, 255, 0.08)");
        context.fillStyle = "rgba(236, 244, 255, 0.65)";
        context.font = "500 13px Segoe UI";
        context.fillText(label, 502, y + 22);
    });

    const buttonWidth = 228 * clamp(sceneProgress + 0.2, 0.22, 1);
    const gradient = context.createLinearGradient(486, 0, 714, 0);
    gradient.addColorStop(0, "#6ce9ff");
    gradient.addColorStop(1, "#f8c56e");
    roundRect(context, 486, 438, buttonWidth, 40, 16, gradient);
    context.fillStyle = "#081524";
    context.font = "700 14px Segoe UI";
    context.fillText("Enter Dashboard", 548, 463);
}

function drawProfileScene(context, sceneProgress, stats, focusTask) {
    roundRect(context, 398, 254, 420, 84, 20, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");
    context.fillStyle = "#ecf4ff";
    context.font = "700 16px Segoe UI";
    context.fillText("Current focus", 424, 286);
    context.font = "700 24px Segoe UI";
    context.fillText(focusTask ? truncateText(focusTask.title, 24) : "No active focus", 424, 318);

    const metricCards = [
        `Overdue ${stats.overdue}`,
        `Due Today ${stats.dueToday}`,
        `Blocked ${stats.blocked}`
    ];

    metricCards.forEach((label, index) => {
        roundRect(context, 398 + (index * 138), 356, 124, 78, 18, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");
        context.fillStyle = "#dbe8f7";
        context.font = "600 14px Segoe UI";
        context.fillText(label, 416 + (index * 138), 394);
        context.font = "700 22px Segoe UI";
        context.fillText(String([stats.overdue, stats.dueToday, stats.blocked][index]), 416 + (index * 138), 422);
    });

    const animatedWidth = 340 * clamp(0.4 + (sceneProgress * 0.55), 0.2, 1);
    roundRect(context, 398, 466, 360, 18, 10, "rgba(255, 255, 255, 0.07)");
    const fillGradient = context.createLinearGradient(398, 0, 758, 0);
    fillGradient.addColorStop(0, "#39d0ff");
    fillGradient.addColorStop(1, "#4ade80");
    roundRect(context, 398, 466, animatedWidth, 18, 10, fillGradient);
    context.fillStyle = "#dbe8f7";
    context.font = "600 15px Segoe UI";
    context.fillText(`Weekly completion ${Math.round(clamp(62 + (sceneProgress * 18), 0, 100))}%`, 398, 452);
}

function drawStatisticsScene(context, sceneProgress, tasks, stats) {
    context.fillStyle = "#dbe8f7";
    context.font = "700 16px Segoe UI";
    context.fillText("Execution summary table", 398, 270);

    const tableX = 398;
    const tableY = 290;
    const rowHeight = 42;
    const columns = [0, 190, 300, 420, 560];
    roundRect(context, tableX, tableY, 398, 190, 18, "rgba(255, 255, 255, 0.03)", "rgba(255, 255, 255, 0.06)");
    context.fillStyle = "rgba(255, 255, 255, 0.05)";
    context.fillRect(tableX, tableY, 398, rowHeight);
    context.fillStyle = "#ecf4ff";
    context.font = "700 13px Segoe UI";
    ["Task", "Priority", "Status", "Due", "Progress"].forEach((label, index) => {
        context.fillText(label, tableX + 18 + columns[index], tableY + 26);
    });

    tasks.slice(0, 3).forEach((task, index) => {
        const y = tableY + rowHeight + (index * rowHeight);
        context.strokeStyle = "rgba(255, 255, 255, 0.06)";
        context.beginPath();
        context.moveTo(tableX, y);
        context.lineTo(tableX + 398, y);
        context.stroke();
        context.fillStyle = "#dbe8f7";
        context.font = "600 13px Segoe UI";
        context.fillText(truncateText(task.title, 18), tableX + 18, y + 25);
        context.fillText(getPriorityMeta(task.priority).label, tableX + 18 + columns[1], y + 25);
        context.fillText(getStatusMeta(task.status).label, tableX + 18 + columns[2], y + 25);
        context.fillText(formatDueDate(task.dueDate), tableX + 18 + columns[3], y + 25);
        context.fillText(`${Math.round(task.progress * clamp(0.7 + (sceneProgress * 0.4), 0.7, 1) / 1)}%`, tableX + 18 + columns[4], y + 25);
    });

    roundRect(context, 398, 498, 398, 18, 10, "rgba(255, 255, 255, 0.07)");
    const chartWidth = 398 * clamp(0.28 + (sceneProgress * 0.62), 0.2, 1);
    const chartGradient = context.createLinearGradient(398, 0, 796, 0);
    chartGradient.addColorStop(0, "#39d0ff");
    chartGradient.addColorStop(1, "#f8c56e");
    roundRect(context, 398, 498, chartWidth, 18, 10, chartGradient);
    context.fillStyle = "#dbe8f7";
    context.font = "600 14px Segoe UI";
    context.fillText(`Completion rate ${stats.completionRate}%`, 398, 490);
}

function drawTasksScene(context, sceneProgress, tasks) {
    const targetTasks = tasks.slice(0, 2);
    targetTasks.forEach((task, index) => {
        const y = 258 + (index * 118);
        roundRect(context, 398, y, 398, 96, 18, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");
        context.fillStyle = "#ecf4ff";
        context.font = "700 16px Segoe UI";
        context.fillText(truncateText(task.title, 30), 420, y + 28);
        context.fillStyle = "rgba(236, 244, 255, 0.72)";
        context.font = "600 13px Segoe UI";
        context.fillText(`${getStatusMeta(task.status).label} - ${getDueMeta(task).label}`, 420, y + 52);

        roundRect(context, 420, y + 66, 272, 12, 8, "rgba(255, 255, 255, 0.07)");
        const fillGradient = context.createLinearGradient(420, 0, 692, 0);
        fillGradient.addColorStop(0, "#39d0ff");
        fillGradient.addColorStop(1, index === 0 ? "#f8c56e" : "#4ade80");
        const animatedProgress = clamp((task.progress / 100) * (0.68 + sceneProgress * 0.32), 0.08, 1);
        roundRect(context, 420, y + 66, 272 * animatedProgress, 12, 8, fillGradient);

        roundRect(context, 710, y + 22, 68, 28, 14, "rgba(255, 255, 255, 0.05)", "rgba(255, 255, 255, 0.08)");
        context.fillStyle = "#dbe8f7";
        context.font = "700 12px Segoe UI";
        context.fillText(index === 0 ? "Edit" : "View", 731, y + 40);
    });

    roundRect(context, 398, 504, 398, 42, 16, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");
    context.fillStyle = "#ecf4ff";
    context.font = "700 14px Segoe UI";
    context.fillText("Recent activity", 420, 531);
    context.fillStyle = "rgba(236, 244, 255, 0.72)";
    context.font = "600 13px Segoe UI";
    context.fillText(`Updated deadline and subtasks - ${Math.round(sceneProgress * 100)}% scene transition`, 538, 531);
}

function drawProgressScene(context, sceneProgress, stats) {
    const labels = ["HTML", "CSS", "JavaScript"];
    const values = [85, 70, 55].map((value, index) => clamp(value - 4 + (sceneProgress * (8 + index * 4)), 0, 100));

    labels.forEach((label, index) => {
        const y = 274 + (index * 74);
        context.fillStyle = "#dbe8f7";
        context.font = "700 14px Segoe UI";
        context.fillText(label, 398, y - 10);
        roundRect(context, 398, y, 338, 16, 9, "rgba(255, 255, 255, 0.07)");
        const fillGradient = context.createLinearGradient(398, 0, 736, 0);
        fillGradient.addColorStop(0, "#39d0ff");
        fillGradient.addColorStop(1, index === 2 ? "#f8c56e" : "#4ade80");
        roundRect(context, 398, y, 338 * (values[index] / 100), 16, 9, fillGradient);
        context.fillText(`${Math.round(values[index])}%`, 748, y + 13);
    });

    roundRect(context, 398, 510, 180, 34, 14, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");
    roundRect(context, 594, 510, 202, 34, 14, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");
    context.fillStyle = "#ecf4ff";
    context.font = "700 13px Segoe UI";
    context.fillText(`Media ready`, 448, 532);
    context.fillText(`Completion ${stats.completionRate}%`, 636, 532);
}

function drawAdminScene(context, sceneProgress, stats) {
    roundRect(context, 398, 258, 206, 198, 18, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");
    roundRect(context, 620, 258, 176, 198, 18, "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.06)");

    context.fillStyle = "#ecf4ff";
    context.font = "700 16px Segoe UI";
    context.fillText("Task form", 420, 288);

    ["Task title", "Priority", "Due date"].forEach((label, index) => {
        const y = 314 + (index * 46);
        roundRect(context, 420, y, 162, 30, 12, "rgba(255, 255, 255, 0.05)", "rgba(255, 255, 255, 0.08)");
        context.fillStyle = "rgba(236, 244, 255, 0.66)";
        context.font = "500 12px Segoe UI";
        context.fillText(label, 434, y + 20);
    });

    const buttonGradient = context.createLinearGradient(420, 0, 582, 0);
    buttonGradient.addColorStop(0, "#6ce9ff");
    buttonGradient.addColorStop(1, "#f8c56e");
    roundRect(context, 420, 452, 162 * clamp(0.4 + (sceneProgress * 0.6), 0.2, 1), 34, 14, buttonGradient);
    context.fillStyle = "#081524";
    context.font = "700 13px Segoe UI";
    context.fillText("Add Task", 476, 474);

    context.fillStyle = "#ecf4ff";
    context.font = "700 16px Segoe UI";
    context.fillText("Live counters", 640, 288);

    [`Total ${stats.total}`, `Overdue ${stats.overdue}`, `Week ${stats.completionThisWeek}`].forEach((label, index) => {
        roundRect(context, 640, 314 + (index * 52), 136, 38, 14, "rgba(255, 255, 255, 0.05)", "rgba(255, 255, 255, 0.08)");
        context.fillStyle = "#dbe8f7";
        context.font = "600 13px Segoe UI";
        context.fillText(label, 658, 338 + (index * 52));
    });
}

function drawSceneFooter(context, sceneIndex, sceneCount, width, height) {
    const baseX = 412;
    const y = height - 76;
    for (let i = 0; i < sceneCount; i += 1) {
        const active = i === sceneIndex;
        context.beginPath();
        context.fillStyle = active ? "#6ce9ff" : "rgba(255, 255, 255, 0.18)";
        context.arc(baseX + (i * 24), y, active ? 7 : 5, 0, Math.PI * 2);
        context.fill();
    }

    context.fillStyle = "rgba(236, 244, 255, 0.72)";
    context.font = "600 13px Segoe UI";
    context.fillText(`Scene ${sceneIndex + 1} / ${sceneCount}`, width - 194, height - 72);
}

function truncateText(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}

function roundRect(context, x, y, width, height, radius, fillStyle, strokeStyle = "") {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
    context.fillStyle = fillStyle;
    context.fill();

    if (strokeStyle) {
        context.strokeStyle = strokeStyle;
        context.lineWidth = 1;
        context.stroke();
    }
}

function renderAdminPage() {
    const taskForm = document.getElementById("taskForm");
    const taskList = document.getElementById("taskList");
    const adminOverview = document.getElementById("adminOverview");

    if (!taskForm || !taskList || !adminOverview) {
        return;
    }

    const input = document.getElementById("taskInput");
    const prioritySelect = document.getElementById("taskPriority");
    const dueDateInput = document.getElementById("taskDueDate");
    const tasks = getTasks();
    const stats = getTaskStats(tasks);
    const customTasks = tasks.filter((task) => task.custom);

    if (dueDateInput && !dueDateInput.value) {
        dueDateInput.value = suggestDueDate(prioritySelect ? prioritySelect.value : "medium");
    }

    if (prioritySelect && dueDateInput) {
        prioritySelect.onchange = () => {
            dueDateInput.value = suggestDueDate(prioritySelect.value);
        };
    }

    adminOverview.innerHTML = [
        { label: "Total tasks", value: stats.total },
        { label: "Overdue", value: stats.overdue },
        { label: "Due today", value: stats.dueToday },
        { label: "Completion this week", value: stats.completionThisWeek }
    ]
        .map((card) => `
            <article class="metric-card">
                <span>${card.label}</span>
                <strong>${card.value}</strong>
            </article>
        `)
        .join("");

    taskList.innerHTML = customTasks.length
        ? customTasks
              .map((task) => {
                  const priority = getPriorityMeta(task.priority);
                  const status = getStatusMeta(task.status);
                  const dueMeta = getDueMeta(task);
                  const latest = task.history.slice().sort((a, b) => new Date(b.at) - new Date(a.at))[0];
                  const latestMeta = latest ? getActivityMeta(latest.action) : null;
                  return `
                    <article class="stack-item">
                        <div>
                            <strong>${escapeHtml(task.title)}</strong>
                            <span>${status.label} - ${task.progress}% - ${dueMeta.label}</span>
                            ${latestMeta ? `<small class="inline-helper">${latestMeta.label}: ${escapeHtml(latest.note)}</small>` : ""}
                        </div>
                        <span class="priority-badge ${priority.className}">${priority.label}</span>
                    </article>
                `;
              })
              .join("")
        : `<div class="empty-state">No custom tasks have been added yet.</div>`;

    taskForm.onsubmit = (event) => {
        event.preventDefault();
        const title = input.value.trim();
        const priority = prioritySelect.value;
        const dueDate = dueDateInput ? dueDateInput.value : "";

        if (!title) {
            return;
        }

        const nextTask = createTask(title, priority, dueDate);
        const nextTasks = [...getTasks(), nextTask];
        saveTasks(nextTasks);
        pushActivityLogEntry(nextTask, "created", `Task "${nextTask.title}" was created with 3 smart subtasks.`, nextTask.createdAt);
        input.value = "";
        prioritySelect.value = "medium";
        if (dueDateInput) {
            dueDateInput.value = suggestDueDate("medium");
        }
        renderAllViews();
        showToast(`"${nextTask.title}" was added to the board.`, "success");
    };
}

function wireTaskEditorModal() {
    const modal = document.getElementById("taskEditorModal");
    const form = document.getElementById("taskEditForm");

    if (!modal || !form) {
        return;
    }

    modal.querySelectorAll("[data-edit-close]").forEach((element) => {
        element.addEventListener("click", closeTaskEditor);
    });

    form.addEventListener("submit", handleTaskEditSubmit);
}

function openTaskEditor(taskId) {
    const modal = document.getElementById("taskEditorModal");
    const task = getTasks().find((item) => item.id === taskId);

    if (!modal || !task) {
        return;
    }

    UI_STATE.editingTaskId = taskId;
    setText("editTaskNamePreview", task.title);
    setText("editTaskStatusPreview", getStatusMeta(task.status).label);

    const titleInput = document.getElementById("editTaskTitle");
    const priorityInput = document.getElementById("editTaskPriority");
    const dueDateInput = document.getElementById("editTaskDueDate");
    const reasonInput = document.getElementById("editTaskReason");
    const subtaskInputs = [
        document.getElementById("editSubtask1"),
        document.getElementById("editSubtask2"),
        document.getElementById("editSubtask3")
    ];

    if (titleInput) titleInput.value = task.title;
    if (priorityInput) priorityInput.value = task.priority;
    if (dueDateInput) dueDateInput.value = task.dueDate;
    if (reasonInput) reasonInput.value = task.reason || "";
    subtaskInputs.forEach((input, index) => {
        if (input) {
            input.value = task.subtasks[index] ? task.subtasks[index].title : "";
        }
    });

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
}

function closeTaskEditor() {
    const modal = document.getElementById("taskEditorModal");
    const form = document.getElementById("taskEditForm");

    UI_STATE.editingTaskId = null;
    if (form) {
        form.reset();
    }

    if (!modal) {
        return;
    }

    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}

function handleTaskEditSubmit(event) {
    event.preventDefault();

    if (!UI_STATE.editingTaskId) {
        return;
    }

    const title = (document.getElementById("editTaskTitle")?.value || "").trim();
    const priority = document.getElementById("editTaskPriority")?.value || "medium";
    const dueDate = document.getElementById("editTaskDueDate")?.value || "";
    const reason = (document.getElementById("editTaskReason")?.value || "").trim();
    const subtaskTitles = [
        document.getElementById("editSubtask1")?.value || "",
        document.getElementById("editSubtask2")?.value || "",
        document.getElementById("editSubtask3")?.value || ""
    ];

    if (!title) {
        return;
    }

    updateTask(UI_STATE.editingTaskId, (task) => {
        const fallbackSubtasks = generateSubtasks(title);
        const subtasks = task.subtasks.map((subtask, index) => ({
            ...subtask,
            title: subtaskTitles[index].trim() || fallbackSubtasks[index].title
        }));

        return {
            ...task,
            title,
            priority,
            dueDate: normalizeDateInput(dueDate) || suggestDueDate(priority),
            reason,
            subtasks,
            updatedAt: new Date().toISOString()
        };
    }, (before, after) => ({
        action: "updated",
        note: buildTaskEditSummary(before, after)
    }));

    closeTaskEditor();
    showToast("Task details were updated successfully.", "success");
}

function buildTaskEditSummary(before, after) {
    const changes = [];

    if (before.title !== after.title) {
        changes.push("title");
    }

    if (before.priority !== after.priority) {
        changes.push("priority");
    }

    if (before.dueDate !== after.dueDate) {
        changes.push("deadline");
    }

    if ((before.reason || "") !== (after.reason || "")) {
        changes.push("reason");
    }

    const subtaskChanged = before.subtasks.some((subtask, index) => subtask.title !== after.subtasks[index].title);
    if (subtaskChanged) {
        changes.push("subtasks");
    }

    if (!changes.length) {
        return "Opened the task editor and saved without structural changes.";
    }

    return `Updated ${changes.join(", ")} for "${after.title}".`;
}

function getRecentActivity(limit = 6) {
    return getActivityLog()
        .slice()
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, limit);
}

function getDueMeta(task) {
    if (!task.dueDate) {
        return { label: "No deadline", className: "neutral" };
    }

    if (isTaskOverdue(task)) {
        return { label: `Overdue - due ${formatDueDate(task.dueDate)}`, className: "overdue" };
    }

    if (isTaskDueToday(task)) {
        return { label: `Due today - ${formatDueDate(task.dueDate)}`, className: "today" };
    }

    if (isTaskDueTomorrow(task)) {
        return { label: `Due tomorrow - ${formatDueDate(task.dueDate)}`, className: "upcoming" };
    }

    return { label: `Due ${formatDueDate(task.dueDate)}`, className: "upcoming" };
}

function getRiskMeta(task) {
    if (task.status === "completed") {
        return { label: "Closed", tone: "progress" };
    }

    if (task.status === "blocked") {
        return { label: "At Risk", tone: "critical" };
    }

    if (task.status === "cancelled") {
        return { label: "Cancelled", tone: "calm" };
    }

    if (isTaskOverdue(task)) {
        return { label: "Overdue", tone: "critical" };
    }

    if (isTaskDueToday(task) || isTaskDueTomorrow(task)) {
        return { label: "Due Soon", tone: "focus" };
    }

    if (task.status === "in_progress") {
        return { label: "Moving", tone: "progress" };
    }

    return { label: "Safe", tone: "calm" };
}

function formatSortLabel(sortKey) {
    const labels = {
        deadline: "deadline urgency",
        priority: "priority",
        updated: "last updated",
        progress: "progress",
        title: "title"
    };

    return labels[sortKey] || "deadline urgency";
}

function isTaskOverdue(task) {
    if (!task.dueDate || ["completed", "cancelled"].includes(task.status)) {
        return false;
    }

    const dueDate = parseDateInput(task.dueDate);
    const today = getTodayDateObject();
    return Boolean(dueDate) && dueDate < today;
}

function isTaskDueToday(task) {
    if (!task.dueDate || ["completed", "cancelled"].includes(task.status)) {
        return false;
    }

    const dueDate = parseDateInput(task.dueDate);
    const today = getTodayDateObject();
    return Boolean(dueDate) && dueDate.getTime() === today.getTime();
}

function isTaskDueTomorrow(task) {
    if (!task.dueDate || ["completed", "cancelled"].includes(task.status)) {
        return false;
    }

    const dueDate = parseDateInput(task.dueDate);
    if (!dueDate) {
        return false;
    }

    const tomorrow = getTodayDateObject();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dueDate.getTime() === tomorrow.getTime();
}

function suggestDueDate(priority = "medium", offset = 0) {
    const offsets = {
        high: 2,
        medium: 4,
        low: 6
    };
    const days = (offsets[priority] || 4) + offset;
    const date = getTodayDateObject();
    date.setDate(date.getDate() + days);
    return formatDateInput(date);
}

function normalizeDateInput(value) {
    if (typeof value !== "string") {
        return "";
    }

    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return "";
    }

    const parsed = parseDateInput(trimmed);
    return parsed ? formatDateInput(parsed) : "";
}

function parseDateInput(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
        return null;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
}

function compareDueDates(first, second) {
    const firstDate = parseDateInput(first);
    const secondDate = parseDateInput(second);

    if (!firstDate && !secondDate) {
        return 0;
    }

    if (!firstDate) {
        return 1;
    }

    if (!secondDate) {
        return -1;
    }

    return firstDate - secondDate;
}

function getTodayDateObject() {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
}

function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatDueDate(value) {
    const parsed = parseDateInput(value);
    return parsed
        ? parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "No date";
}

function formatDateTime(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return "Unknown time";
    }

    return parsed.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function isDateWithinLastDays(value, days) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return false;
    }

    const now = Date.now();
    const diff = now - parsed.getTime();
    return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function ensureToastContainer() {
    if (document.getElementById("toastContainer")) {
        return;
    }

    const container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
}

function showToast(message, tone = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) {
        return;
    }

    const toast = document.createElement("div");
    toast.className = `toast tone-${tone}`;
    toast.innerHTML = `
        <strong>${escapeHtml(getToastTitle(tone))}</strong>
        <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add("visible");
    }, 10);

    window.setTimeout(() => {
        toast.classList.remove("visible");
        window.setTimeout(() => {
            toast.remove();
        }, 220);
    }, 2600);
}

function getToastTitle(tone) {
    if (tone === "success") return "Success";
    if (tone === "warning") return "Attention";
    if (tone === "danger") return "Update";
    return "Notice";
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = String(value);
    }
}
