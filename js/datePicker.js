// datePicker.js - 日期欄右側的日曆按鈕與網頁風格的日期時間選擇器（民國年、24 小時制）
const pad = (value) => String(value).padStart(2, "0");
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 解析「115/05/16 09:18」這類民國日期；也接受 - 或 . 分隔、沒有時間。 */
export const parseRocDateTime = (text) => {
  const match = String(text || "")
    .trim()
    .match(/^(\d{2,3})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, rocYear, month, day, hour = "0", minute = "0"] = match;
  const year = Number(rocYear) + 1911;
  const date = new Date(year, Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (date.getFullYear() !== year || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
    return null;
  }
  return date;
};

const formatRocDate = (date) =>
  `${date.getFullYear() - 1911}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
const formatTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
export const formatRocDateTime = (date) => `${formatRocDate(date)} ${formatTime(date)}`;

const parseTime = (text) => {
  const match = String(text || "").trim().match(/^(\d{1,2})[:：]?(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
};

// 防呆：照片不會是未來拍的，選擇器不讓選到「現在」之後的日期時間
const nowMinute = () => {
  const now = new Date();
  now.setSeconds(0, 0);
  return now;
};
const isFuture = (date) => date.getTime() > nowMinute().getTime();
const clampToNow = (date) => (isFuture(date) ? nowMinute() : date);
const monthStart = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

const sameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/* ---------- 選擇器（全頁共用一個） ---------- */

let popover = null;
let current = null; // { input, anchor, selected: Date, view: Date }

const buildPopover = () => {
  const element = document.createElement("div");
  element.className = "date-popover";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "選擇日期與時間");
  element.hidden = true;
  element.innerHTML = `
    <div class="date-popover-fields">
      <input type="text" class="date-popover-date" inputmode="numeric" placeholder="115/05/16" aria-label="日期（民國年/月/日）" />
      <input type="text" class="date-popover-time" inputmode="numeric" placeholder="HH:mm" maxlength="5" aria-label="時間（24 小時制）" />
    </div>
    <p class="date-popover-error" role="alert" hidden></p>
    <div class="date-popover-nav">
      <button type="button" data-nav="-12" aria-label="上一年" title="上一年">${chevron(true, true)}</button>
      <button type="button" data-nav="-1" aria-label="上個月" title="上個月">${chevron(true, false)}</button>
      <span class="date-popover-title" aria-live="polite"></span>
      <button type="button" data-nav="1" aria-label="下個月" title="下個月">${chevron(false, false)}</button>
      <button type="button" data-nav="12" aria-label="下一年" title="下一年">${chevron(false, true)}</button>
    </div>
    <div class="date-popover-calendar">
      <div class="date-popover-weekdays">${WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="date-popover-grid" role="grid"></div>
    </div>
    <div class="date-popover-timepanel" hidden>
      <div class="date-popover-col" data-col="hour" role="listbox" aria-label="時">
        <div class="date-popover-col-title">時</div>
        ${Array.from({ length: 24 }, (_, h) => `<button type="button" role="option" data-hour="${h}">${pad(h)}</button>`).join("")}
      </div>
      <div class="date-popover-col" data-col="minute" role="listbox" aria-label="分">
        <div class="date-popover-col-title">分</div>
        ${Array.from({ length: 60 }, (_, m) => `<button type="button" role="option" data-minute="${m}">${pad(m)}</button>`).join("")}
      </div>
    </div>
    <div class="date-popover-footer">
      <button type="button" class="date-popover-now">現在</button>
      <span class="date-popover-spacer"></span>
      <button type="button" class="date-popover-cancel">取消</button>
      <button type="button" class="date-popover-ok">確定</button>
    </div>`;
  document.body.appendChild(element);

  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.querySelectorAll("[data-nav]").forEach((button) =>
    button.addEventListener("click", () => {
      const step = Number(button.dataset.nav);
      const next = new Date(current.view.getFullYear(), current.view.getMonth() + step, 1);
      const latest = monthStart(new Date());
      current.view = next > latest ? latest : next;
      renderGrid();
    }),
  );
  element.querySelector(".date-popover-grid").addEventListener("click", (event) => {
    const cell = event.target.closest("[data-day]");
    if (!cell) return;
    const [year, month, day] = cell.dataset.day.split("-").map(Number);
    current.selected = clampToNow(
      new Date(year, month, day, current.selected.getHours(), current.selected.getMinutes()),
    );
    current.view = new Date(year, month, 1);
    syncFields();
    renderGrid();
  });
  element.querySelector(".date-popover-grid").addEventListener("dblclick", (event) => {
    if (event.target.closest("[data-day]")) commit();
  });

  const dateField = element.querySelector(".date-popover-date");
  const timeField = element.querySelector(".date-popover-time");
  // 觸控裝置點時間框直接用選的，不跳出鍵盤
  if (window.matchMedia?.("(pointer: coarse)").matches) timeField.readOnly = true;
  dateField.addEventListener("focus", () => setMode("date"));
  dateField.addEventListener("click", () => setMode("date"));
  timeField.addEventListener("focus", () => setMode("time"));
  timeField.addEventListener("click", () => setMode("time"));
  element.querySelector(".date-popover-timepanel").addEventListener("click", (event) => {
    const hourButton = event.target.closest("[data-hour]");
    const minuteButton = event.target.closest("[data-minute]");
    if (!hourButton && !minuteButton) return;
    if ((hourButton || minuteButton).disabled) return;
    if (hourButton) current.selected.setHours(Number(hourButton.dataset.hour));
    if (minuteButton) current.selected.setMinutes(Number(minuteButton.dataset.minute));
    current.selected = clampToNow(current.selected);
    syncFields();
    syncTimePanel(false);
  });
  dateField.addEventListener("input", () => {
    const parsed = parseRocDateTime(dateField.value);
    const today = new Date();
    const future = parsed && parsed >= new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    dateField.classList.toggle("is-invalid", Boolean(dateField.value.trim()) && (!parsed || future));
    dateField.dataset.reason = future ? "future" : parsed ? "" : "format";
    dateField.title = future ? "無法選擇未來的日期、時間，請修正。" : "";
    // 已經按過確定、正在顯示提醒時，修正後提醒跟著更新或消失
    if (!popover.querySelector(".date-popover-error").hidden) showError(fieldProblem());
    if (!parsed || future) return;
    current.selected = new Date(
      parsed.getFullYear(), parsed.getMonth(), parsed.getDate(),
      current.selected.getHours(), current.selected.getMinutes(),
    );
    current.view = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    renderGrid();
  });
  timeField.addEventListener("input", () => {
    // 輸入 4 個數字時自動補上冒號，例如 0918 → 09:18
    const digits = timeField.value.replace(/\D/g, "");
    if (/^\d{4}$/.test(digits) && !timeField.value.includes(":")) {
      timeField.value = `${digits.slice(0, 2)}:${digits.slice(2)}`;
    }
    const parsed = parseTime(timeField.value);
    const candidate = parsed ? new Date(current.selected) : null;
    candidate?.setHours(parsed.hour, parsed.minute);
    const future = candidate && isFuture(candidate);
    timeField.classList.toggle("is-invalid", Boolean(timeField.value.trim()) && (!parsed || future));
    timeField.dataset.reason = future ? "future" : parsed ? "" : "format";
    timeField.title = future ? "無法選擇未來的日期、時間，請修正。" : "";
    if (!popover.querySelector(".date-popover-error").hidden) showError(fieldProblem());
    if (!parsed || future) return;
    current.selected.setHours(parsed.hour, parsed.minute);
    syncTimePanel(true);
  });
  [dateField, timeField].forEach((field) =>
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    }),
  );
  element.querySelector(".date-popover-now").addEventListener("click", () => {
    const now = new Date();
    now.setSeconds(0, 0);
    current.selected = now;
    current.view = new Date(now.getFullYear(), now.getMonth(), 1);
    syncFields();
    renderGrid();
    syncTimePanel(true);
  });
  element.querySelector(".date-popover-cancel").addEventListener("click", () => close(true));
  element.querySelector(".date-popover-ok").addEventListener("click", commit);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  });
  return element;
};

function chevron(left, double) {
  const one = left ? "M12.5 5 7.5 10l5 5" : "M7.5 5l5 5-5 5";
  const two = left ? "M10 5 5 10l5 5M15 5l-5 5 5 5" : "M5 5l5 5-5 5M10 5l5 5-5 5";
  return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="${double ? two : one}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const showError = (message) => {
  const error = popover?.querySelector(".date-popover-error");
  if (!error) return;
  error.textContent = message || "";
  error.hidden = !message;
};

/** 輸入框的錯誤原因（沒有錯誤回傳空字串） */
const fieldProblem = () => {
  const dateField = popover.querySelector(".date-popover-date");
  const timeField = popover.querySelector(".date-popover-time");
  if (dateField.classList.contains("is-invalid")) {
    return dateField.dataset.reason === "future" ? "無法選擇未來的日期、時間，請修正。" : "日期格式不正確，請輸入例如 115/05/16。";
  }
  if (timeField.classList.contains("is-invalid")) {
    return timeField.dataset.reason === "future" ? "無法選擇未來的日期、時間，請修正。" : "時間格式不正確，請輸入例如 09:18（24 小時制）。";
  }
  return "";
};

/** 月曆與時分清單切換：點日期框看月曆，點時間框選時分。 */
const setMode = (mode) => {
  if (!popover || !current) return;
  const isTime = mode === "time";
  popover.classList.toggle("is-time-mode", isTime);
  popover.querySelector(".date-popover-timepanel").hidden = !isTime;
  popover.querySelector(".date-popover-calendar").hidden = isTime;
  popover.querySelector(".date-popover-nav").hidden = isTime;
  if (isTime) syncTimePanel(true);
};

const syncTimePanel = (scroll) => {
  if (!popover || !current) return;
  const hour = current.selected.getHours();
  const minute = current.selected.getMinutes();
  const now = nowMinute();
  const isToday = sameDay(current.selected, now);
  popover.querySelectorAll("[data-hour]").forEach((button) => {
    const value = Number(button.dataset.hour);
    const on = value === hour;
    button.classList.toggle("is-selected", on);
    button.setAttribute("aria-selected", String(on));
    button.disabled = isToday && value > now.getHours();
  });
  popover.querySelectorAll("[data-minute]").forEach((button) => {
    const value = Number(button.dataset.minute);
    const on = value === minute;
    button.classList.toggle("is-selected", on);
    button.setAttribute("aria-selected", String(on));
    button.disabled = isToday && hour === now.getHours() && value > now.getMinutes();
  });
  if (!scroll || popover.querySelector(".date-popover-timepanel").hidden) return;
  popover.querySelectorAll(".date-popover-col").forEach((column) => {
    const selected = column.querySelector(".is-selected");
    if (selected) column.scrollTop = selected.offsetTop - column.clientHeight / 2 + selected.offsetHeight / 2;
  });
};

const syncFields = () => {
  popover.querySelector(".date-popover-date").value = formatRocDate(current.selected);
  popover.querySelector(".date-popover-time").value = formatTime(current.selected);
  popover.querySelectorAll(".is-invalid").forEach((field) => field.classList.remove("is-invalid"));
  showError("");
};

const renderGrid = () => {
  const { view, selected } = current;
  popover.querySelector(".date-popover-title").textContent =
    `${view.getFullYear() - 1911} 年 ${view.getMonth() + 1} 月`;
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const today = new Date();
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const atLatestMonth = monthStart(view) >= monthStart(today);
  popover.querySelectorAll('[data-nav="1"], [data-nav="12"]').forEach((button) => {
    button.disabled = atLatestMonth;
  });
  const cells = [];
  for (let i = 0; i < first.getDay(); i += 1) cells.push('<span class="date-popover-empty"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(view.getFullYear(), view.getMonth(), day);
    const classes = ["date-popover-day"];
    if (sameDay(date, today)) classes.push("is-today");
    if (sameDay(date, selected)) classes.push("is-selected");
    const disabled = date >= endOfToday;
    cells.push(
      `<button type="button" class="${classes.join(" ")}" data-day="${view.getFullYear()}-${view.getMonth()}-${day}" aria-label="${view.getFullYear() - 1911} 年 ${view.getMonth() + 1} 月 ${day} 日"${sameDay(date, selected) ? ' aria-pressed="true"' : ""}${disabled ? " disabled" : ""}>${day}</button>`,
    );
  }
  popover.querySelector(".date-popover-grid").innerHTML = cells.join("");
};

const position = () => {
  if (!current || popover.hidden) return;
  // 手機：從畫面底部滑出，不跟著欄位移動
  const isSheet = window.innerWidth <= 560;
  popover.classList.toggle("is-sheet", isSheet);
  if (isSheet) {
    popover.style.left = "";
    popover.style.top = "";
    return;
  }
  const rect = current.anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const margin = 8;
  let left = Math.min(rect.right - width, window.innerWidth - width - margin);
  left = Math.max(margin, left);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - margin && rect.top - height - 6 > margin) {
    top = rect.top - height - 6;
  }
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(margin, top)}px`;
};

const onOutside = (event) => {
  if (!current) return;
  if (popover.contains(event.target) || current.anchor.contains(event.target)) return;
  close(false);
};

const close = (returnFocus) => {
  if (!current) return;
  const { button } = current;
  popover.hidden = true;
  current = null;
  document.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("resize", position);
  window.removeEventListener("scroll", position, true);
  if (returnFocus) button?.focus();
};

const commit = () => {
  if (!current) return;
  const dateField = popover.querySelector(".date-popover-date");
  const timeField = popover.querySelector(".date-popover-time");
  const problem = fieldProblem();
  if (problem) {
    showError(problem);
    (dateField.classList.contains("is-invalid") ? dateField : timeField).focus();
    return;
  }
  if (isFuture(current.selected)) current.selected = nowMinute();
  const { input } = current;
  input.value = formatRocDateTime(current.selected);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  close(false);
  input.focus();
};

const open = (input, anchor, button, fallback) => {
  popover ||= buildPopover();
  const start = clampToNow(parseRocDateTime(input.value) || parseRocDateTime(fallback) || new Date());
  start.setSeconds(0, 0);
  current = { input, anchor, button, selected: start, view: new Date(start.getFullYear(), start.getMonth(), 1) };
  syncFields();
  renderGrid();
  popover.hidden = false;
  setMode("date");
  position();
  document.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  popover.querySelector(".date-popover-selected, .is-selected, .date-popover-day")?.focus({ preventScroll: true });
};

/**
 * 把文字日期欄包起來，右側加上日曆按鈕。
 * getFallback：欄位空白時，選擇器預設停在哪個日期（例如照片的拍攝日期），回傳民國日期文字。
 */
export const attachDatePicker = (input, { getFallback = () => "", wrapperClass = "" } = {}) => {
  if (!input || input.dataset.datePicker === "true") return input?.parentElement;
  input.dataset.datePicker = "true";
  const wrapper = document.createElement("span");
  wrapper.className = `date-field ${wrapperClass}`.trim();
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "date-field-btn";
  button.title = "用日曆選擇日期與時間";
  button.setAttribute("aria-label", "用日曆選擇日期與時間");
  button.setAttribute("aria-haspopup", "dialog");
  // 細線條、圓角的簡約日曆圖示（與側邊欄收合圖示同一風格）
  button.innerHTML =
    '<svg class="date-field-icon" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
    '<rect x="3" y="4.25" width="14" height="12.5" rx="3" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M3.5 8.25h13M7 2.75v3M13 2.75v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    "</svg>";
  wrapper.appendChild(button);

  button.addEventListener("click", () => {
    if (current?.input === input) {
      close(true);
      return;
    }
    open(input, wrapper, button, getFallback());
  });
  return wrapper;
};
