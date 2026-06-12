const chatWindow = document.querySelector("#chatWindow");
const chatForm = document.querySelector("#chatForm");
const questionInput = document.querySelector("#questionInput");
const faqForm = document.querySelector("#faqForm");
const faqId = document.querySelector("#faqId");
const faqQuestion = document.querySelector("#faqQuestion");
const faqAnswer = document.querySelector("#faqAnswer");
const faqCategory = document.querySelector("#faqCategory");
const faqMessage = document.querySelector("#faqMessage");
const faqFormTitle = document.querySelector("#faqFormTitle");
const faqFormHelp = document.querySelector("#faqFormHelp");
const saveFaqButton = document.querySelector("#saveFaqButton");
const cancelEditFaq = document.querySelector("#cancelEditFaq");
const serverStatus = document.querySelector("#serverStatus");
const queryList = document.querySelector("#queryList");
const refreshQueries = document.querySelector("#refreshQueries");
const filterButtons = document.querySelectorAll("[data-query-filter]");
const themeToggle = document.querySelector("#themeToggle");
const themeLabel = document.querySelector("#themeLabel");
const quickPrompts = document.querySelectorAll("[data-prompt]");
const dashboardButtons = document.querySelectorAll("[data-dashboard-target]");
const dashboardPanels = document.querySelectorAll("[data-dashboard-panel]");
const faqList = document.querySelector("#faqList");
const faqSearch = document.querySelector("#faqSearch");
const refreshFaqs = document.querySelector("#refreshFaqs");
const adminLock = document.querySelector("#adminLock");
const adminContent = document.querySelector("#adminContent");
const adminLoginForm = document.querySelector("#adminLoginForm");
const adminPasscode = document.querySelector("#adminPasscode");
const adminLoginMessage = document.querySelector("#adminLoginMessage");
const adminFaqList = document.querySelector("#adminFaqList");
const adminFaqSearch = document.querySelector("#adminFaqSearch");
const refreshAdminFaqs = document.querySelector("#refreshAdminFaqs");
const totalFaqs = document.querySelector("#totalFaqs");
const totalQueries = document.querySelector("#totalQueries");
const unansweredQueries = document.querySelector("#unansweredQueries");
const categoryCount = document.querySelector("#categoryCount");
const studentFaqCount = document.querySelector("#studentFaqCount");
const studentCategoryCount = document.querySelector("#studentCategoryCount");
let activeQueryFilter = "all";
let allFaqs = [];
let adminPasscodeValue = "";
let apiBaseUrl = localStorage.getItem("cimage-ai-chatbot-api-base") || "";
let starterFaqsPromise = null;
const localApiPorts = ["5059", "5058", "5000", "8888", "3000"];

function getLocalApiCandidates() {
    const candidates = [];

    if (apiBaseUrl) {
        candidates.push(apiBaseUrl);
    }

    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
        candidates.push(window.location.origin);
    }

    for (const port of localApiPorts) {
        candidates.push(`http://127.0.0.1:${port}`, `http://localhost:${port}`);
    }

    return [...new Set(candidates)];
}

async function apiFetch(path, options = {}) {
    const apiPath = path.startsWith("/") ? path : `/${path}`;
    const hasAdminPasscode = options.headers instanceof Headers
        ? options.headers.has("x-admin-passcode")
        : Boolean(options.headers?.["x-admin-passcode"]);
    let lastError = null;
    let firstUnauthorizedResponse = null;

    for (const baseUrl of getLocalApiCandidates()) {
        try {
            const response = await fetch(`${baseUrl}${apiPath}`, options);

            if (apiPath.startsWith("/api/")) {
                const contentType = response.headers.get("content-type") || "";

                if (response.status === 404 || !contentType.includes("application/json")) {
                    lastError = new Error("Connected to a server that is not the CIMAGE AI Chatbot API.");
                    continue;
                }
            }

            if (response.status === 401 && hasAdminPasscode) {
                firstUnauthorizedResponse ||= response.clone();
                lastError = new Error("Invalid admin passcode.");
                continue;
            }

            apiBaseUrl = baseUrl;
            localStorage.setItem("cimage-ai-chatbot-api-base", baseUrl);
            return response;
        } catch (error) {
            lastError = error;
        }
    }

    if (firstUnauthorizedResponse) {
        return firstUnauthorizedResponse;
    }

    apiBaseUrl = "";
    localStorage.removeItem("cimage-ai-chatbot-api-base");
    throw lastError || new Error("Could not connect to the CIMAGE AI Chatbot server.");
}

async function readJsonResponse(response, fallbackMessage) {
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
        throw new Error("Connected to the wrong server. Open the app from the running CIMAGE AI Chatbot URL.");
    }

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || fallbackMessage);
    }

    return data;
}

function getPreferredTheme() {
    const storedTheme = localStorage.getItem("cimage-ai-chatbot-theme");

    if (storedTheme) {
        return storedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
    const isDark = theme === "dark";

    document.documentElement.dataset.theme = theme;
    themeLabel.textContent = isDark ? "Dark" : "Light";
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
}

function setDashboard(target) {
    dashboardButtons.forEach((button) => {
        const isActive = button.dataset.dashboardTarget === target;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-current", isActive ? "page" : "false");
    });

    dashboardPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.dashboardPanel === target);
    });

    localStorage.setItem("cimage-ai-chatbot-dashboard", target);

    if (target === "admin") {
        if (isAdminUnlocked()) {
            loadAdminDashboard();
        } else {
            adminPasscode?.focus();
        }
    } else {
        questionInput.focus();
    }
}

function addMessage(text, sender) {
    const message = document.createElement("article");
    message.className = `message ${sender}`;
    message.textContent = text;
    chatWindow.appendChild(message);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return message;
}

function setMessage(element, text, type) {
    element.textContent = text;
    element.className = `form-message ${type || ""}`.trim();
}

function formatQueryDate(value) {
    return new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date(value));
}

function getFaqId(faq) {
    return faq._id || faq.id;
}

function isAdminUnlocked() {
    return Boolean(adminPasscodeValue);
}

function getAdminHeaders(extraHeaders = {}) {
    return {
        ...extraHeaders,
        "x-admin-passcode": adminPasscodeValue
    };
}

function setAdminUnlocked(unlocked) {
    adminLock.classList.toggle("hidden", unlocked);
    adminContent.classList.toggle("locked", !unlocked);
}

function updateStudentStats(stats) {
    studentFaqCount.textContent = String(stats.totalFaqs || 0);
    studentCategoryCount.textContent = String(stats.categories || 0);
}

function updateAdminStats(stats) {
    totalFaqs.textContent = String(stats.totalFaqs || 0);
    totalQueries.textContent = String(stats.totalQueries || 0);
    unansweredQueries.textContent = String(stats.unansweredQueries || 0);
    categoryCount.textContent = String(stats.categories || 0);
}

async function loadPublicStats() {
    try {
        const response = await apiFetch("/api/public-stats");
        const data = await readJsonResponse(response, "Could not load dashboard stats.");

        updateStudentStats(data.stats);
    } catch (error) {
        console.warn(error.message);
    }
}

async function loadStarterFaqs() {
    if (!starterFaqsPromise) {
        starterFaqsPromise = fetch("faqs.json", {
            cache: "no-store"
        }).then((response) => response.json());
    }

    const data = await starterFaqsPromise;

    if (!Array.isArray(data)) {
        throw new Error("Starter FAQ file is not valid.");
    }

    return data;
}

function normalizeText(value) {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

function getKeywords(value) {
    return normalizeText(value)
        .split(/\s+/)
        .filter((word) => word.length > 2);
}

function findBestLocalFaq(question, faqs = allFaqs) {
    const normalizedQuestion = normalizeText(question);
    const exactMatch = faqs.find((faq) => normalizeText(faq.question) === normalizedQuestion);

    if (exactMatch) {
        return exactMatch;
    }

    const keywords = getKeywords(question);

    if (!keywords.length) {
        return null;
    }

    let bestMatch = null;
    let bestScore = 0;

    for (const faq of faqs) {
        const searchableText = normalizeText(`${faq.question} ${faq.category || ""}`);
        const score = keywords.filter((keyword) => searchableText.includes(keyword)).length;

        if (score > bestScore) {
            bestMatch = faq;
            bestScore = score;
        }
    }

    return bestScore > 0 ? bestMatch : null;
}

async function getLocalAnswer(question) {
    if (!allFaqs.length) {
        allFaqs = await loadStarterFaqs();
        filterStudentFaqs();
        filterAdminFaqs();
    }

    const faq = findBestLocalFaq(question);

    return faq?.answer || "Sorry, I don't know the answer.";
}

async function loadAdminStats() {
    const response = await apiFetch("/api/stats", {
        headers: getAdminHeaders()
    });
    const data = await readJsonResponse(response, "Could not load admin stats.");

    updateAdminStats(data.stats);
}

function renderStudentFaqs(faqs) {
    faqList.innerHTML = "";

    if (!faqs.length) {
        const empty = document.createElement("p");
        empty.className = "query-meta";
        empty.textContent = "No FAQs found.";
        faqList.appendChild(empty);
        return;
    }

    for (const faq of faqs) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "faq-item";
        item.dataset.question = faq.question;

        const question = document.createElement("span");
        question.className = "faq-question";
        question.textContent = faq.question;

        const category = document.createElement("span");
        category.className = "faq-category";
        category.textContent = faq.category || "General";

        item.append(question, category);
        faqList.appendChild(item);
    }
}

function renderAdminFaqs(faqs) {
    adminFaqList.innerHTML = "";

    if (!faqs.length) {
        const empty = document.createElement("p");
        empty.className = "query-meta";
        empty.textContent = "No FAQs found.";
        adminFaqList.appendChild(empty);
        return;
    }

    for (const faq of faqs) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "admin-faq-item";
        item.dataset.id = getFaqId(faq);

        const question = document.createElement("span");
        question.className = "faq-question";
        question.textContent = faq.question;

        const answer = document.createElement("span");
        answer.className = "faq-answer-preview";
        answer.textContent = faq.answer;

        const category = document.createElement("span");
        category.className = "faq-category";
        category.textContent = faq.category || "General";

        item.append(question, answer, category);
        adminFaqList.appendChild(item);
    }
}

function getFilteredFaqs(searchValue) {
    const searchTerm = searchValue.trim().toLowerCase();

    if (!searchTerm) {
        return allFaqs;
    }

    return allFaqs.filter((faq) => {
        const searchableText = `${faq.question} ${faq.answer} ${faq.category || ""}`.toLowerCase();
        return searchableText.includes(searchTerm);
    });
}

function filterStudentFaqs() {
    renderStudentFaqs(getFilteredFaqs(faqSearch.value));
}

function filterAdminFaqs() {
    renderAdminFaqs(getFilteredFaqs(adminFaqSearch.value));
}

async function loadFaqs() {
    faqList.innerHTML = "";
    const loading = document.createElement("p");
    loading.className = "query-meta";
    loading.textContent = "Loading FAQs...";
    faqList.appendChild(loading);

    try {
        const response = await apiFetch("/api/faqs?limit=100");
        const data = await readJsonResponse(response, "Could not load FAQs.");

        allFaqs = data.faqs;
        filterStudentFaqs();
        filterAdminFaqs();
    } catch (error) {
        try {
            allFaqs = await loadStarterFaqs();
            filterStudentFaqs();
            filterAdminFaqs();
            updateStudentStats({
                totalFaqs: allFaqs.length,
                categories: new Set(allFaqs.map((faq) => faq.category).filter(Boolean)).size
            });
        } catch (fallbackError) {
            faqList.innerHTML = "";
            adminFaqList.innerHTML = "";
            const message = document.createElement("p");
            message.className = "query-meta";
            message.textContent = error.message;
            faqList.appendChild(message);
            adminFaqList.appendChild(message.cloneNode(true));
        }
    }
}

function renderQueries(queries) {
    queryList.innerHTML = "";

    if (!queries.length) {
        const empty = document.createElement("p");
        empty.className = "query-meta";
        empty.textContent = "No queries saved yet.";
        queryList.appendChild(empty);
        return;
    }

    for (const query of queries) {
        const item = document.createElement("article");
        item.className = "query-item";
        item.tabIndex = 0;
        item.dataset.question = query.question;

        const question = document.createElement("p");
        question.className = "query-question";
        question.textContent = query.question;

        const badge = document.createElement("span");
        badge.className = `query-badge ${query.matched ? "answered" : "unanswered"}`;
        badge.textContent = query.matched ? "Answered" : "Unanswered";

        const meta = document.createElement("p");
        meta.className = "query-meta";
        meta.textContent = `${query.category || "No category"} - ${formatQueryDate(query.createdAt)}`;

        item.append(question, badge, meta);
        queryList.appendChild(item);
    }
}

async function fetchQueries({ filter = "all", limit = "25" } = {}) {
    const params = new URLSearchParams({ limit });

    if (filter === "unanswered") {
        params.set("status", "unanswered");
    }

    const response = await apiFetch(`/api/queries?${params.toString()}`, {
        headers: getAdminHeaders()
    });
    const data = await readJsonResponse(response, "Could not load queries.");

    return data.queries;
}

async function loadQueries() {
    if (!isAdminUnlocked()) {
        return;
    }

    queryList.innerHTML = "";
    const loading = document.createElement("p");
    loading.className = "query-meta";
    loading.textContent = "Loading queries...";
    queryList.appendChild(loading);

    try {
        const visibleQueries = await fetchQueries({ filter: activeQueryFilter, limit: "25" });

        renderQueries(visibleQueries);
        await loadAdminStats();
    } catch (error) {
        queryList.innerHTML = "";
        const message = document.createElement("p");
        message.className = "query-meta";
        message.textContent = error.message;
        queryList.appendChild(message);
    }
}

async function loadAdminDashboard() {
    if (!isAdminUnlocked()) {
        return;
    }

    try {
        await Promise.all([loadAdminStats(), loadQueries(), loadFaqs()]);
    } catch (error) {
        setMessage(adminLoginMessage, error.message, "error");
        adminPasscodeValue = "";
        setAdminUnlocked(false);
    }
}

function resetFaqForm() {
    faqForm.reset();
    faqId.value = "";
    faqFormTitle.textContent = "Add FAQ";
    faqFormHelp.textContent = "Create answers for common student questions or unresolved queries.";
    saveFaqButton.textContent = "Save FAQ";
    cancelEditFaq.classList.add("hidden");
}

function editFaq(id) {
    const faq = allFaqs.find((item) => getFaqId(item) === id);

    if (!faq) {
        return;
    }

    faqId.value = id;
    faqQuestion.value = faq.question;
    faqAnswer.value = faq.answer;
    faqCategory.value = faq.category || "";
    faqFormTitle.textContent = "Edit FAQ";
    faqFormHelp.textContent = "Update the saved answer students receive from the chatbot.";
    saveFaqButton.textContent = "Update FAQ";
    cancelEditFaq.classList.remove("hidden");
    faqAnswer.focus();
}

async function checkServer() {
    try {
        await apiFetch("/api/public-stats");
        serverStatus.textContent = "Online";
        serverStatus.className = "status online";
    } catch (error) {
        try {
            await loadStarterFaqs();
            serverStatus.textContent = "Online";
            serverStatus.className = "status online";
            serverStatus.title = "Online with built-in FAQs. Admin features need the backend server.";
        } catch (fallbackError) {
            serverStatus.textContent = "Offline";
            serverStatus.className = "status offline";
            serverStatus.title = "The app could not reach the backend or built-in FAQ file.";
        }
    }
}

chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const question = questionInput.value.trim();
    if (!question) return;

    addMessage(question, "user");
    questionInput.value = "";
    chatForm.querySelector("button").disabled = true;
    const thinkingMessage = addMessage("Finding the best answer...", "bot thinking");

    try {
        const response = await apiFetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ question })
        });
        const data = await readJsonResponse(response, "Could not get an answer.");

        thinkingMessage.remove();
        addMessage(data.answer, "bot");
        loadPublicStats();

        if (isAdminUnlocked()) {
            loadQueries();
        }
    } catch (error) {
        thinkingMessage.remove();
        try {
            const answer = await getLocalAnswer(question);
            addMessage(answer, "bot");
        } catch (fallbackError) {
            addMessage(error.message, "bot");
        }
    } finally {
        chatForm.querySelector("button").disabled = false;
        questionInput.focus();
    }
});

adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(adminLoginMessage, "", "");

    adminPasscodeValue = adminPasscode.value.trim();

    if (!adminPasscodeValue) {
        setMessage(adminLoginMessage, "Enter the admin passcode.", "error");
        return;
    }

    try {
        await loadAdminStats();
        adminPasscode.value = "";
        setAdminUnlocked(true);
        setMessage(adminLoginMessage, "Admin unlocked.", "success");
        await loadAdminDashboard();
    } catch (error) {
        adminPasscodeValue = "";
        setAdminUnlocked(false);
        setMessage(adminLoginMessage, error.message, "error");
    }
});

faqForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(faqMessage, "", "");

    if (!isAdminUnlocked()) {
        setMessage(faqMessage, "Unlock admin access first.", "error");
        return;
    }

    const payload = {
        question: faqQuestion.value.trim(),
        answer: faqAnswer.value.trim(),
        category: faqCategory.value.trim()
    };
    const isEditing = Boolean(faqId.value);
    const url = isEditing ? `/api/faqs/${faqId.value}` : "/api/add-faq";
    const method = isEditing ? "PUT" : "POST";

    try {
        const response = await apiFetch(url, {
            method,
            headers: getAdminHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify(payload)
        });
        const data = await readJsonResponse(response, "Could not save FAQ.");

        resetFaqForm();
        setMessage(faqMessage, data.message, "success");
        await Promise.all([loadFaqs(), loadPublicStats(), loadAdminStats(), loadQueries()]);
    } catch (error) {
        setMessage(faqMessage, error.message, "error");
    }
});

filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
        activeQueryFilter = button.dataset.queryFilter;

        filterButtons.forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        loadQueries();
    });
});

dashboardButtons.forEach((button) => {
    button.addEventListener("click", () => {
        setDashboard(button.dataset.dashboardTarget);
    });
});

refreshQueries.addEventListener("click", loadQueries);
refreshFaqs.addEventListener("click", loadFaqs);
refreshAdminFaqs.addEventListener("click", loadFaqs);
faqSearch.addEventListener("input", filterStudentFaqs);
adminFaqSearch.addEventListener("input", filterAdminFaqs);
cancelEditFaq.addEventListener("click", resetFaqForm);

themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";

    localStorage.setItem("cimage-ai-chatbot-theme", nextTheme);
    applyTheme(nextTheme);
});

quickPrompts.forEach((button) => {
    button.addEventListener("click", () => {
        questionInput.value = button.dataset.prompt;
        questionInput.focus();
    });
});

faqList.addEventListener("click", (event) => {
    const item = event.target.closest(".faq-item");

    if (!item) return;

    questionInput.value = item.dataset.question;
    questionInput.focus();
});

adminFaqList.addEventListener("click", (event) => {
    const item = event.target.closest(".admin-faq-item");

    if (!item) return;

    editFaq(item.dataset.id);
});

queryList.addEventListener("click", (event) => {
    const item = event.target.closest(".query-item");

    if (!item) return;

    resetFaqForm();
    faqQuestion.value = item.dataset.question;
    faqAnswer.focus();
});

queryList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;

    const item = event.target.closest(".query-item");

    if (!item) return;

    resetFaqForm();
    faqQuestion.value = item.dataset.question;
    faqAnswer.focus();
});

applyTheme(getPreferredTheme());
setAdminUnlocked(isAdminUnlocked());
setDashboard(localStorage.getItem("cimage-ai-chatbot-dashboard") || "student");
checkServer();
loadPublicStats();
loadFaqs();
