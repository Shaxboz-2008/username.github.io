(function () {
    "use strict";

    const STORAGE_KEY = "myBudgetData";
    const OLD_TX_KEY = "myBudgetTransactions";
    const THEME_KEY = "myBudgetTheme";
    const LAST_EXPORT_KEY = "myBudgetLastExport";
    const SCHEMA_VERSION = 1;

    const DARK_THEME_VARS = {
        "--bg": "#0b1220",
        "--bg-soft": "#121b2f",
        "--panel": "#151f35",
        "--line": "#25314a",
        "--text": "#edf3ff",
        "--muted": "#97a7c6"
    };

    const categoryMap = {
        salary: { type: "income", name: "Зарплата", icon: "fa-money-bill-wave", bgColor: "#183d2f", textColor: "#44e8a6" },
        freelance: { type: "income", name: "Фриланс", icon: "fa-laptop-code", bgColor: "#17384d", textColor: "#68c6ff" },
        investments: { type: "income", name: "Инвестиции", icon: "fa-chart-line", bgColor: "#3f3c12", textColor: "#ffd766" },
        groceries: { type: "expense", name: "Продукты", icon: "fa-basket-shopping", bgColor: "#402028", textColor: "#ff8fa3" },
        transport: { type: "expense", name: "Транспорт", icon: "fa-bus", bgColor: "#1e2e4b", textColor: "#8db0ff" },
        entertainment: { type: "expense", name: "Развлечения", icon: "fa-film", bgColor: "#382752", textColor: "#d5a3ff" },
        utilities: { type: "expense", name: "Коммунальные", icon: "fa-lightbulb", bgColor: "#4d2f20", textColor: "#ffb483" },
        other: { type: "expense", name: "Другое", icon: "fa-ellipsis-h", bgColor: "#2f3745", textColor: "#b7c5df" }
    };

    const EXPENSE_KEYS = Object.keys(categoryMap).filter(k => categoryMap[k].type === "expense");

    let transactions = [];
    let budgets = {};
    let currentEditingId = null;
    let categoryChart = null;
    let yearlyTrendChart = null;
    let compareChart = null;
    let weekdayChart = null;

    let confirmCallback = null;
    let pendingImportPayload = null;

    function newId() {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function loadState() {
        const rawNew = localStorage.getItem(STORAGE_KEY);
        if (rawNew) {
            try {
                const data = JSON.parse(rawNew);
                if (Array.isArray(data)) {
                    return { transactions: data, budgets: {} };
                }
                return {
                    transactions: Array.isArray(data.transactions) ? data.transactions : [],
                    budgets: data.budgets && typeof data.budgets === "object" ? data.budgets : {}
                };
            } catch {
                return { transactions: [], budgets: {} };
            }
        }
        const rawOld = localStorage.getItem(OLD_TX_KEY);
        if (rawOld) {
            try {
                const parsed = JSON.parse(rawOld);
                if (Array.isArray(parsed)) {
                    localStorage.setItem(
                        STORAGE_KEY,
                        JSON.stringify({ version: SCHEMA_VERSION, transactions: parsed, budgets: {} })
                    );
                    localStorage.removeItem(OLD_TX_KEY);
                    return { transactions: parsed, budgets: {} };
                }
            } catch {
                /* ignore */
            }
        }
        return { transactions: [], budgets: {} };
    }

    function saveState() {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: SCHEMA_VERSION,
                transactions,
                budgets
            })
        );
    }

    function parseImportedFile(text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return { transactions: parsed, budgets: null };
        }
        const txs = Array.isArray(parsed.transactions) ? parsed.transactions : [];
        const bud = parsed.budgets && typeof parsed.budgets === "object" ? parsed.budgets : null;
        return { transactions: txs, budgets: bud };
    }

    function showToast(message, type = "info") {
        const container = document.getElementById("toastContainer");
        if (!container) return;
        const el = document.createElement("div");
        el.className = `toast toast-${type}`;
        el.setAttribute("role", "status");
        el.textContent = message;
        container.appendChild(el);
        requestAnimationFrame(() => el.classList.add("toast-show"));
        setTimeout(() => {
            el.classList.remove("toast-show");
            setTimeout(() => el.remove(), 300);
        }, 4200);
    }

    function openConfirmModal(message) {
        return new Promise(resolve => {
            confirmCallback = resolve;
            document.getElementById("confirmMessage").textContent = message;
            document.getElementById("confirmModal").classList.add("active");
            document.getElementById("confirmOkBtn").focus();
        });
    }

    function closeConfirmModal(result) {
        document.getElementById("confirmModal").classList.remove("active");
        const cb = confirmCallback;
        confirmCallback = null;
        if (cb) cb(result);
    }

    function applyDarkTheme() {
        const root = document.documentElement.style;
        Object.entries(DARK_THEME_VARS).forEach(([k, v]) => root.setProperty(k, v));
        document.body.dataset.theme = "dark";
    }

    function applyLightTheme() {
        document.body.dataset.theme = "light";
        const root = document.documentElement.style;
        root.setProperty("--bg", "#eef4ff");
        root.setProperty("--bg-soft", "#ffffff");
        root.setProperty("--panel", "#ffffff");
        root.setProperty("--line", "#d7e0f3");
        root.setProperty("--text", "#15243f");
        root.setProperty("--muted", "#546784");
    }

    function chartTickColor() {
        return getComputedStyle(document.body).color;
    }

    function getPeriodMode() {
        const el = document.getElementById("periodMode");
        return el ? el.value : "month";
    }

    function monthRange(year, monthIndex) {
        return {
            start: new Date(year, monthIndex, 1, 0, 0, 0, 0),
            end: new Date(year, monthIndex + 1, 0, 23, 59, 59, 999)
        };
    }

    function getPeriodFilterRange() {
        const mode = getPeriodMode();
        const now = new Date();
        if (mode === "month") {
            const v = document.getElementById("periodMonth").value;
            if (!v) {
                return monthRange(now.getFullYear(), now.getMonth());
            }
            const [y, m] = v.split("-").map(Number);
            return monthRange(y, m - 1);
        }
        if (mode === "year") {
            const y = parseInt(document.getElementById("periodYear").value, 10) || now.getFullYear();
            return {
                start: new Date(y, 0, 1, 0, 0, 0, 0),
                end: new Date(y, 11, 31, 23, 59, 59, 999)
            };
        }
        let fromVal = document.getElementById("periodFrom").value;
        let toVal = document.getElementById("periodTo").value;
        if (!fromVal || !toVal) {
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 30);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }
        const start = new Date(fromVal + "T00:00:00");
        const end = new Date(toVal + "T23:59:59.999");
        if (start > end) return { start: end, end: start };
        return { start, end };
    }

    function txDate(t) {
        const d = new Date(t.date + "T12:00:00");
        return d;
    }

    function transactionInRange(t, start, end) {
        const d = txDate(t);
        return d >= start && d <= end;
    }

    function transactionsInPeriod() {
        const { start, end } = getPeriodFilterRange();
        return transactions.filter(t => transactionInRange(t, start, end));
    }

    function syncPeriodInputsVisibility() {
        const mode = getPeriodMode();
        const m = document.getElementById("periodMonthWrap");
        const y = document.getElementById("periodYearWrap");
        const r = document.getElementById("periodRangeWrap");
        if (m) m.hidden = mode !== "month";
        if (y) y.hidden = mode !== "year";
        if (r) r.hidden = mode !== "range";
    }

    function initPeriodControls() {
        const now = new Date();
        const pm = document.getElementById("periodMonth");
        const py = document.getElementById("periodYear");
        const pf = document.getElementById("periodFrom");
        const pt = document.getElementById("periodTo");
        if (pm) pm.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        if (py) py.value = String(now.getFullYear());
        if (pf && pt) {
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 30);
            pf.value = formatInputDate(start);
            pt.value = formatInputDate(end);
        }
        document.getElementById("periodMode").addEventListener("change", () => {
            syncPeriodInputsVisibility();
            refreshDashboard();
        });
        ["periodMonth", "periodYear", "periodFrom", "periodTo"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener("change", refreshDashboard);
        });
        syncPeriodInputsVisibility();
    }

    function formatInputDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    function getBudgetMonthValue() {
        const el = document.getElementById("budgetMonth");
        if (!el || !el.value) {
            const n = new Date();
            return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
        }
        return el.value;
    }

    function spendingInCalendarMonth(monthStr) {
        const [y, m] = monthStr.split("-").map(Number);
        const { start, end } = monthRange(y, m - 1);
        const byCat = {};
        EXPENSE_KEYS.forEach(k => {
            byCat[k] = 0;
        });
        transactions
            .filter(t => t.type === "expense" && transactionInRange(t, start, end))
            .forEach(t => {
                const k = categoryMap[t.category] ? t.category : "other";
                if (byCat[k] !== undefined) byCat[k] += t.amount;
            });
        return byCat;
    }

    function renderBudgetPanel() {
        const bm = document.getElementById("budgetMonth");
        if (bm && getPeriodMode() === "month") {
            const pm = document.getElementById("periodMonth");
            if (pm && pm.value) bm.value = pm.value;
        }
        const panel = document.getElementById("budgetPanelRows");
        const monthStr = getBudgetMonthValue();
        const spent = spendingInCalendarMonth(monthStr);
        const limits = budgets[monthStr] || {};
        if (!panel) return;

        panel.innerHTML = EXPENSE_KEYS.map(key => {
            const limit = Number(limits[key]) || 0;
            const s = spent[key] || 0;
            const pct = limit > 0 ? Math.min(100, Math.round((s / limit) * 100)) : 0;
            const over = limit > 0 && s > limit;
            const rowClass = over ? "budget-row over-budget" : "budget-row";
            const fillW = limit > 0 ? Math.min(100, (s / limit) * 100) : 0;
            const limitLabel = limit > 0 ? formatCurrency(limit) : "нет лимита";
            return `
                <div class="${rowClass}">
                    <div class="budget-row-head">
                        <span class="name">${categoryMap[key].name}</span>
                        <span class="pct">${limit > 0 ? `${pct}%` : "—"} · ${formatCurrency(s)} / ${limitLabel}</span>
                    </div>
                    <div class="budget-bar"><div class="budget-bar-fill" style="width:${limit > 0 ? fillW : 0}%"></div></div>
                </div>`;
        }).join("");
    }

    function renderBudgetSettingsFields() {
        const wrap = document.getElementById("budgetSettingsFields");
        const monthInput = document.getElementById("settingsBudgetMonth");
        if (!monthInput) return;
        const monthStr = monthInput.value || getBudgetMonthValue();
        const limits = budgets[monthStr] || {};
        wrap.innerHTML = EXPENSE_KEYS.map(key => {
            const v = limits[key] != null ? limits[key] : "";
            return `
                <div class="form-group">
                    <label for="bud-${key}">${categoryMap[key].name}</label>
                    <input type="number" id="bud-${key}" data-cat="${key}" min="0" step="1" placeholder="0" value="${v === "" ? "" : v}">
                </div>`;
        }).join("");
    }

    function saveBudgetsFromSettings() {
        const monthInput = document.getElementById("settingsBudgetMonth");
        const monthStr = monthInput.value;
        if (!monthStr) {
            showToast("Выберите месяц для лимитов.", "error");
            return;
        }
        const next = { ...budgets[monthStr] };
        EXPENSE_KEYS.forEach(key => {
            const inp = document.getElementById(`bud-${key}`);
            if (!inp) return;
            const n = Number(inp.value);
            if (n > 0) next[key] = n;
            else delete next[key];
        });
        if (Object.keys(next).length === 0) delete budgets[monthStr];
        else budgets[monthStr] = next;
        saveState();
        showToast("Лимиты сохранены.", "success");
        renderBudgetPanel();
    }

    function initTabs() {
        const tabButtons = document.querySelectorAll(".tab-btn");
        const panels = document.querySelectorAll(".tab-content");

        function activateTab(tabId) {
            tabButtons.forEach(b => {
                const on = b.dataset.tab === tabId;
                b.classList.toggle("active", on);
                b.setAttribute("aria-selected", on ? "true" : "false");
                b.tabIndex = on ? 0 : -1;
            });
            panels.forEach(p => {
                const on = p.id === tabId;
                p.classList.toggle("active", on);
                p.hidden = !on;
            });
            requestAnimationFrame(resizeAllCharts);
        }

        tabButtons.forEach((button, idx) => {
            button.addEventListener("click", () => activateTab(button.dataset.tab));
            button.addEventListener("keydown", e => {
                let n = idx;
                if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (idx + 1) % tabButtons.length;
                else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (idx - 1 + tabButtons.length) % tabButtons.length;
                else if (e.key === "Home") n = 0;
                else if (e.key === "End") n = tabButtons.length - 1;
                else return;
                e.preventDefault();
                tabButtons[n].focus();
                activateTab(tabButtons[n].dataset.tab);
            });
        });

        activateTab(tabButtons[0].dataset.tab);
    }

    function resizeAllCharts() {
        [categoryChart, yearlyTrendChart, compareChart, weekdayChart].forEach(ch => {
            if (ch && typeof ch.resize === "function") ch.resize();
        });
    }

    function initTheme() {
        const saved = localStorage.getItem(THEME_KEY) || "dark";
        if (saved === "light") applyLightTheme();
        else applyDarkTheme();

        document.getElementById("themeToggleBtn").addEventListener("click", () => {
            if (document.body.dataset.theme === "light") {
                localStorage.setItem(THEME_KEY, "dark");
                applyDarkTheme();
            } else {
                localStorage.setItem(THEME_KEY, "light");
                applyLightTheme();
            }
            refreshDashboard();
        });
    }

    function bindTransactionTypeToCategory() {
        document.querySelectorAll('input[name="transactionType"]').forEach(radio => {
            radio.addEventListener("change", () => updateCategoryDropdown(null));
        });
    }

    function updateCategoryDropdown(preferredCategory) {
        const typeInput = document.querySelector('input[name="transactionType"]:checked');
        const type = typeInput ? typeInput.value : "expense";
        const select = document.getElementById("category");
        const pairs = Object.entries(categoryMap).filter(([, meta]) => meta.type === type);
        select.innerHTML =
            '<option value="">Выберите категорию</option>' +
            pairs.map(([value, meta]) => `<option value="${value}">${meta.name}</option>`).join("");
        const keep =
            preferredCategory &&
            categoryMap[preferredCategory] &&
            categoryMap[preferredCategory].type === type;
        select.value = keep ? preferredCategory : "";
    }

    function collectTransactionFilters() {
        return {
            type: document.getElementById("filterType").value,
            search: document.getElementById("searchInput").value.trim().toLowerCase(),
            category: document.getElementById("filterCategory").value,
            dateFrom: document.getElementById("filterDateFrom").value,
            dateTo: document.getElementById("filterDateTo").value,
            sortBy: document.getElementById("sortBy").value
        };
    }

    function setupFilters() {
        const onFilter = () => renderTransactions();
        ["filterType", "sortBy", "filterCategory"].forEach(id => {
            document.getElementById(id).addEventListener("change", onFilter);
        });
        document.getElementById("searchInput").addEventListener("input", onFilter);
        ["filterDateFrom", "filterDateTo"].forEach(id => {
            document.getElementById(id).addEventListener("change", onFilter);
        });
    }

    function setupSettingsTools() {
        document.getElementById("clearAllBtn").addEventListener("click", async () => {
            const ok = await openConfirmModal("Точно удалить все операции? Это действие нельзя отменить.");
            if (!ok) return;
            transactions = [];
            saveState();
            refreshDashboard();
            showToast("Все операции удалены.", "info");
        });

        document.getElementById("exportBtn").addEventListener("click", () => {
            const blob = new Blob(
                [
                    JSON.stringify(
                        { version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), transactions, budgets },
                        null,
                        2
                    )
                ],
                { type: "application/json" }
            );
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `budget-backup-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            URL.revokeObjectURL(link.href);
            localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
            showToast("JSON сохранён.", "success");
        });

        document.getElementById("exportCsvBtn").addEventListener("click", () => {
            const rows = [
                ["date", "type", "category", "description", "amount"].join(";"),
                ...transactions.map(t => {
                    const cname = (categoryMap[t.category] || categoryMap.other).name;
                    const safe = (t.description || "").replaceAll('"', '""');
                    return [t.date, t.type, cname, `"${safe}"`, String(t.amount).replace(".", ",")].join(";");
                })
            ];
            const bom = "\uFEFF";
            const blob = new Blob([bom + rows.join("\n")], { type: "text/csv;charset=utf-8" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `budget-${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(link.href);
            localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
            showToast("CSV сохранён.", "success");
        });

        document.getElementById("copyJsonBtn").addEventListener("click", async () => {
            const text = JSON.stringify({ version: SCHEMA_VERSION, transactions, budgets }, null, 2);
            try {
                await navigator.clipboard.writeText(text);
                localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
                showToast("JSON скопирован в буфер обмена.", "success");
            } catch {
                showToast("Не удалось скопировать.", "error");
            }
        });

        document.getElementById("importBtn").addEventListener("click", () => {
            document.getElementById("importInput").click();
        });

        document.getElementById("importInput").addEventListener("change", event => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    pendingImportPayload = parseImportedFile(reader.result);
                    document.getElementById("importStats").textContent = `Найдено операций: ${pendingImportPayload.transactions.length}.`;
                    document.getElementById("importModal").classList.add("active");
                    document.querySelector('input[name="importMode"][value="merge"]').checked = true;
                } catch {
                    showToast("Не удалось прочитать файл. Проверьте JSON.", "error");
                }
            };
            reader.readAsText(file);
            event.target.value = "";
        });

        document.getElementById("saveBudgetsBtn").addEventListener("click", saveBudgetsFromSettings);
        document.getElementById("settingsBudgetMonth").addEventListener("change", renderBudgetSettingsFields);

        document.getElementById("duplicateLastBtn").addEventListener("click", () => {
            if (!transactions.length) {
                showToast("Нет операций для копирования.", "info");
                return;
            }
            const last = [...transactions].sort((a, b) => txDate(b) - txDate(a))[0];
            currentEditingId = null;
            document.getElementById("transactionForm").reset();
            document.getElementById("modalTitle").textContent = "Добавить операцию (копия)";
            document.querySelector(`input[name="transactionType"][value="${last.type}"]`).checked = true;
            updateCategoryDropdown(last.category);
            document.getElementById("amount").value = last.amount;
            document.getElementById("description").value = last.description ? `${last.description} (копия)` : "Копия";
            document.getElementById("date").valueAsDate = new Date();
            openTransactionModal();
        });
    }

    function applyImport() {
        if (!pendingImportPayload) return;
        const mode = document.querySelector('input[name="importMode"]:checked').value;
        const incoming = pendingImportPayload.transactions;
        const existingIds = new Set(transactions.map(t => t.id));
        const conflict = incoming.some(t => existingIds.has(t.id));

        if (mode === "abort" && conflict) {
            showToast("Импорт отменён: есть совпадающие id.", "error");
            pendingImportPayload = null;
            document.getElementById("importModal").classList.remove("active");
            return;
        }

        if (mode === "replace") {
            transactions = incoming.slice();
            budgets = pendingImportPayload.budgets ? { ...pendingImportPayload.budgets } : {};
        } else {
            const seen = new Set(transactions.map(t => t.id));
            incoming.forEach(t => {
                if (seen.has(t.id)) return;
                transactions.push(t);
                seen.add(t.id);
            });
            if (pendingImportPayload.budgets) {
                Object.assign(budgets, pendingImportPayload.budgets);
            }
        }

        saveState();
        pendingImportPayload = null;
        document.getElementById("importModal").classList.remove("active");
        refreshDashboard();
        showToast("Импорт выполнен.", "success");
    }

    function setupImportModal() {
        document.getElementById("importCancelBtn").addEventListener("click", () => {
            pendingImportPayload = null;
            document.getElementById("importModal").classList.remove("active");
        });
        document.getElementById("importConfirmBtn").addEventListener("click", applyImport);
    }

    function setupConfirmModal() {
        document.getElementById("confirmOkBtn").addEventListener("click", () => closeConfirmModal(true));
        document.getElementById("confirmCancelBtn").addEventListener("click", () => closeConfirmModal(false));
    }

    function setupForm() {
        document.getElementById("transactionForm").addEventListener("submit", event => {
            event.preventDefault();
            const type = document.querySelector('input[name="transactionType"]:checked').value;
            const amount = Number(document.getElementById("amount").value);
            const category = document.getElementById("category").value;
            const description = document.getElementById("description").value.trim() || "Без описания";
            const date = document.getElementById("date").value;
            const catMeta = categoryMap[category];

            if (!amount || amount <= 0 || !category || !date) {
                showToast("Заполните поля корректно.", "error");
                return;
            }

            if (!catMeta || catMeta.type !== type) {
                showToast("Категория не соответствует типу операции.", "error");
                return;
            }

            if (currentEditingId !== null) {
                const item = transactions.find(t => t.id === currentEditingId);
                if (item) {
                    item.type = type;
                    item.amount = amount;
                    item.category = category;
                    item.description = description;
                    item.date = date;
                }
            } else {
                transactions.push({
                    id: newId(),
                    type,
                    amount,
                    category,
                    description,
                    date
                });
            }

            saveState();
            closeTransactionModal();
            refreshDashboard();
            showToast("Операция сохранена.", "success");
        });
    }

    function refreshDashboard() {
        updateSummary();
        renderTransactions();
        renderQuickPeriodStats();
        renderBudgetPanel();
        initCharts();
    }

    function updateSummary() {
        const slice = transactionsInPeriod();
        const income = slice.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
        const expense = slice.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
        const balance = income - expense;

        document.getElementById("incomeAmount").textContent = formatCurrency(income);
        document.getElementById("expenseAmount").textContent = formatCurrency(expense);
        document.getElementById("balanceAmount").textContent = formatCurrency(balance);
    }

    function renderQuickPeriodStats() {
        const list = document.getElementById("quickMonthList");
        const slice = transactionsInPeriod();
        const income = slice.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
        const expense = slice.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
        const operationsCount = slice.length;
        const avgCheck = operationsCount ? slice.reduce((sum, t) => sum + t.amount, 0) / operationsCount : 0;

        list.innerHTML = `
            <li><span>Операций за период</span><strong>${operationsCount}</strong></li>
            <li><span>Доход за период</span><strong class="income-amount">${formatCurrency(income)}</strong></li>
            <li><span>Расход за период</span><strong class="expense-amount">${formatCurrency(expense)}</strong></li>
            <li><span>Средняя сумма операции</span><strong>${formatCurrency(avgCheck)}</strong></li>
        `;
    }

    function renderTransactions() {
        const f = collectTransactionFilters();
        const list = document.getElementById("transactionsList");

        let filtered = transactions.filter(item => (f.type === "all" ? true : item.type === f.type));
        if (f.search) filtered = filtered.filter(item => (item.description || "").toLowerCase().includes(f.search));
        if (f.category && f.category !== "all") filtered = filtered.filter(item => item.category === f.category);

        if (f.dateFrom) {
            const df = new Date(f.dateFrom + "T00:00:00");
            filtered = filtered.filter(item => txDate(item) >= df);
        }
        if (f.dateTo) {
            const dt = new Date(f.dateTo + "T23:59:59.999");
            filtered = filtered.filter(item => txDate(item) <= dt);
        }

        filtered.sort((a, b) => {
            if (f.sortBy === "dateAsc") return txDate(a) - txDate(b);
            if (f.sortBy === "amountDesc") return b.amount - a.amount;
            if (f.sortBy === "amountAsc") return a.amount - b.amount;
            return txDate(b) - txDate(a);
        });

        if (!filtered.length) {
            list.innerHTML =
                '<li class="empty-transactions"><i class="fas fa-wallet"></i><p>Нет операций под текущий фильтр</p></li>';
            return;
        }

        list.innerHTML = "";
        filtered.forEach(transaction => {
            const categoryInfo = categoryMap[transaction.category] || categoryMap.other;
            const sign = transaction.type === "income" ? "+" : "-";
            const amountClass = transaction.type === "income" ? "income-transaction" : "expense-transaction";
            const txId = transaction.id;

            const item = document.createElement("li");
            item.className = "transaction-item";
            item.innerHTML = `
                    <div class="transaction-content">
                        <div class="transaction-info">
                            <div class="transaction-icon" style="background:${categoryInfo.bgColor};color:${categoryInfo.textColor}">
                                <i class="fas ${categoryInfo.icon}"></i>
                            </div>
                            <div class="transaction-details">
                                <p>${escapeHtml(transaction.description)}</p>
                                <span>${categoryInfo.name} • ${formatDate(transaction.date)}</span>
                            </div>
                        </div>
                        <div class="transaction-amount">
                            <p class="${amountClass}">${sign}${formatCurrency(transaction.amount)}</p>
                            <div class="transaction-actions">
                                <button type="button" class="icon-btn" title="Изменить"><i class="fas fa-pen"></i></button>
                                <button type="button" class="icon-btn" title="Удалить"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    </div>
                `;
            const [btnEdit, btnDel] = item.querySelectorAll(".icon-btn");
            btnEdit.addEventListener("click", () => editTransaction(txId));
            btnDel.addEventListener("click", () => deleteTransaction(txId));
            list.appendChild(item);
        });
    }

    function escapeHtml(s) {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function buildTrendSeries(periodTxs, range) {
        const monthsShort = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
        const ms = range.end - range.start;
        const days = Math.ceil(ms / (86400000)) + 1;

        const sameMonth =
            range.start.getMonth() === range.end.getMonth() &&
            range.start.getFullYear() === range.end.getFullYear();

        if (getPeriodMode() === "month" || (days <= 45 && sameMonth)) {
            const labels = [];
            const income = [];
            const expense = [];
            const cur = new Date(range.start);
            while (cur <= range.end) {
                labels.push(`${cur.getDate().toString().padStart(2, "0")}.${(cur.getMonth() + 1).toString().padStart(2, "0")}`);
                const dStr = formatInputDate(cur);
                let inc = 0;
                let exp = 0;
                periodTxs.forEach(t => {
                    if (t.date !== dStr) return;
                    if (t.type === "income") inc += t.amount;
                    else exp += t.amount;
                });
                income.push(inc);
                expense.push(exp);
                cur.setDate(cur.getDate() + 1);
            }
            return { labels, income, expense, gran: "day" };
        }

        if (getPeriodMode() === "range" && days > 45) {
            const labels = [];
            const income = [];
            const expense = [];
            const cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
            const endM = new Date(range.end.getFullYear(), range.end.getMonth(), 1);
            while (cur <= endM) {
                labels.push(`${monthsShort[cur.getMonth()]} ${cur.getFullYear()}`);
                const y = cur.getFullYear();
                const mi = cur.getMonth();
                const mr = monthRange(y, mi);
                let inc = 0;
                let exp = 0;
                periodTxs.forEach(t => {
                    if (!transactionInRange(t, mr.start, mr.end)) return;
                    if (t.type === "income") inc += t.amount;
                    else exp += t.amount;
                });
                income.push(inc);
                expense.push(exp);
                cur.setMonth(cur.getMonth() + 1);
            }
            return { labels, income, expense, gran: "month" };
        }

        if (getPeriodMode() === "year" || days > 400) {
            const y0 = range.start.getFullYear();
            const y1 = range.end.getFullYear();
            const labels = [];
            for (let y = y0; y <= y1; y++) labels.push(String(y));
            const income = labels.map(() => 0);
            const expense = labels.map(() => 0);
            periodTxs.forEach(t => {
                const y = new Date(t.date + "T12:00:00").getFullYear();
                const idx = labels.indexOf(String(y));
                if (idx < 0) return;
                if (t.type === "income") income[idx] += t.amount;
                else expense[idx] += t.amount;
            });
            return { labels, income, expense, gran: "year" };
        }

        const labels = monthsShort.slice();
        const yFocus = range.start.getFullYear();
        const income = Array(12).fill(0);
        const expense = Array(12).fill(0);
        periodTxs.forEach(t => {
            const d = new Date(t.date + "T12:00:00");
            if (d.getFullYear() !== yFocus) return;
            const m = d.getMonth();
            if (t.type === "income") income[m] += t.amount;
            else expense[m] += t.amount;
        });
        return { labels, income, expense, gran: "month" };
    }

    function weekdayBuckets(periodTxs) {
        const names = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
        const sums = Array(7).fill(0);
        periodTxs.forEach(t => {
            if (t.type !== "expense") return;
            const w = new Date(t.date + "T12:00:00").getDay();
            sums[w] += t.amount;
        });
        const order = [1, 2, 3, 4, 5, 6, 0];
        return {
            labels: order.map(i => names[i]),
            data: order.map(i => sums[i])
        };
    }

    function initCharts() {
        if (categoryChart) categoryChart.destroy();
        if (yearlyTrendChart) yearlyTrendChart.destroy();
        if (compareChart) compareChart.destroy();
        if (weekdayChart) weekdayChart.destroy();

        const range = getPeriodFilterRange();
        const periodTxs = transactions.filter(t => transactionInRange(t, range.start, range.end));
        const tickColor = chartTickColor();

        const expenseKeys = EXPENSE_KEYS;
        const expenseData = expenseKeys.map(key =>
            periodTxs.filter(item => item.type === "expense" && item.category === key).reduce((sum, item) => sum + item.amount, 0)
        );

        categoryChart = new Chart(document.getElementById("categoryChart"), {
            type: "doughnut",
            data: {
                labels: expenseKeys.map(key => categoryMap[key].name),
                datasets: [
                    {
                        data: expenseData,
                        backgroundColor: ["#ff5f7c", "#719cff", "#d6a6ff", "#ffb983", "#9eadd0"],
                        borderWidth: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom", labels: { color: tickColor } }
                }
            }
        });

        const trend = buildTrendSeries(periodTxs, range);
        yearlyTrendChart = new Chart(document.getElementById("yearlyTrendChart"), {
            type: "line",
            data: {
                labels: trend.labels,
                datasets: [
                    {
                        label: "Доходы",
                        data: trend.income,
                        borderColor: "#20cf98",
                        backgroundColor: "rgba(32, 207, 152, 0.15)",
                        fill: true,
                        tension: 0.35
                    },
                    {
                        label: "Расходы",
                        data: trend.expense,
                        borderColor: "#ff6684",
                        backgroundColor: "rgba(255, 102, 132, 0.12)",
                        fill: true,
                        tension: 0.35
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: tickColor } } },
                scales: {
                    y: {
                        ticks: {
                            color: tickColor,
                            callback: value => `${value.toLocaleString("ru-RU")} ₽`
                        },
                        grid: { color: "rgba(128,128,128,0.15)" }
                    },
                    x: {
                        ticks: { color: tickColor },
                        grid: { color: "rgba(128,128,128,0.1)" }
                    }
                }
            }
        });

        const incSum = periodTxs.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
        const expSum = periodTxs.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
        compareChart = new Chart(document.getElementById("compareChart"), {
            type: "bar",
            data: {
                labels: ["Доходы", "Расходы"],
                datasets: [{ data: [incSum, expSum], backgroundColor: ["#20cf98", "#ff6684"] }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        ticks: {
                            color: tickColor,
                            callback: value => `${value.toLocaleString("ru-RU")} ₽`
                        },
                        grid: { color: "rgba(128,128,128,0.15)" }
                    },
                    x: { ticks: { color: tickColor }, grid: { display: false } }
                }
            }
        });

        const wd = weekdayBuckets(periodTxs);
        weekdayChart = new Chart(document.getElementById("weekdayChart"), {
            type: "bar",
            data: {
                labels: wd.labels,
                datasets: [
                    {
                        label: "Расходы",
                        data: wd.data,
                        backgroundColor: "#719cff"
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: tickColor,
                            callback: value => `${value.toLocaleString("ru-RU")} ₽`
                        },
                        grid: { color: "rgba(128,128,128,0.15)" }
                    },
                    x: { ticks: { color: tickColor }, grid: { display: false } }
                }
            }
        });
    }

    function formatCurrency(amount) {
        return Number(amount || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
    }

    function formatDate(value) {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "—";
        return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
    }

    function openAddTransactionModal() {
        currentEditingId = null;
        document.getElementById("transactionForm").reset();
        document.getElementById("modalTitle").textContent = "Добавить операцию";
        document.getElementById("date").valueAsDate = new Date();
        updateCategoryDropdown(null);
        openTransactionModal();
    }

    function openTransactionModal() {
        const m = document.getElementById("transactionModal");
        m.classList.add("active");
        m.setAttribute("aria-hidden", "false");
    }

    function closeTransactionModal() {
        const m = document.getElementById("transactionModal");
        m.classList.remove("active");
        m.setAttribute("aria-hidden", "true");
        document.getElementById("transactionForm").reset();
        currentEditingId = null;
        document.getElementById("modalTitle").textContent = "Добавить операцию";
        document.getElementById("date").valueAsDate = new Date();
        updateCategoryDropdown(null);
    }

    function editTransaction(id) {
        const transaction = transactions.find(item => String(item.id) === String(id));
        if (!transaction) return;
        currentEditingId = transaction.id;
        document.querySelector(`input[name="transactionType"][value="${transaction.type}"]`).checked = true;
        updateCategoryDropdown(transaction.category);
        document.getElementById("amount").value = transaction.amount;
        document.getElementById("description").value = transaction.description;
        document.getElementById("date").value = transaction.date;
        document.getElementById("modalTitle").textContent = "Редактировать операцию";
        openTransactionModal();
    }

    async function deleteTransaction(id) {
        const ok = await openConfirmModal("Удалить эту операцию?");
        if (!ok) return;
        transactions = transactions.filter(item => String(item.id) !== String(id));
        saveState();
        refreshDashboard();
        showToast("Операция удалена.", "info");
    }

    function maybeBackupReminder() {
        const last = localStorage.getItem(LAST_EXPORT_KEY);
        if (!last) {
            showToast("Совет: сделайте резервную копию в «Настройках» (экспорт JSON или CSV).", "info");
            return;
        }
        const days = (Date.now() - new Date(last).getTime()) / 86400000;
        if (days > 7) {
            showToast("Давно не экспортировали данные — имеет смысл сделать копию.", "info");
        }
    }

    function setupModalAccessibility() {
        const tx = document.getElementById("transactionModal");
        tx.addEventListener("click", e => {
            if (e.target === tx) closeTransactionModal();
        });
        document.getElementById("importModal").addEventListener("click", e => {
            if (e.target.id === "importModal") {
                pendingImportPayload = null;
                document.getElementById("importModal").classList.remove("active");
            }
        });
        document.getElementById("confirmModal").addEventListener("click", e => {
            if (e.target.id === "confirmModal") closeConfirmModal(false);
        });

        document.addEventListener("keydown", e => {
            if (e.key !== "Escape") return;
            if (document.getElementById("transactionModal").classList.contains("active")) closeTransactionModal();
            else if (document.getElementById("importModal").classList.contains("active")) {
                pendingImportPayload = null;
                document.getElementById("importModal").classList.remove("active");
            } else if (document.getElementById("confirmModal").classList.contains("active")) closeConfirmModal(false);
        });

        document.getElementById("modalCloseBtn").addEventListener("click", closeTransactionModal);
        document.getElementById("formCancelBtn").addEventListener("click", closeTransactionModal);
        document.getElementById("addTransactionBtn").addEventListener("click", openAddTransactionModal);
        document.getElementById("importCloseBtn").addEventListener("click", () => {
            pendingImportPayload = null;
            document.getElementById("importModal").classList.remove("active");
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        const state = loadState();
        transactions = state.transactions;
        budgets = state.budgets;

        initTabs();
        initTheme();
        initPeriodControls();
        bindTransactionTypeToCategory();

        const bm = document.getElementById("budgetMonth");
        const now = new Date();
        bm.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        bm.addEventListener("change", renderBudgetPanel);

        const sm = document.getElementById("settingsBudgetMonth");
        sm.value = bm.value;
        updateCategoryDropdown(null);
        setupForm();
        setupFilters();
        setupSettingsTools();
        setupConfirmModal();
        setupImportModal();
        setupModalAccessibility();

        renderBudgetSettingsFields();
        refreshDashboard();
        document.getElementById("date").valueAsDate = new Date();

        maybeBackupReminder();
    });
})();
