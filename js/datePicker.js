// datePicker.js - 日期欄右側的日曆按鈕：用瀏覽器內建的日期時間選擇器，選完填入民國格式
const pad = (value) => String(value).padStart(2, "0");

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

export const formatRocDateTime = (date) =>
  `${date.getFullYear() - 1911}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

const toLocalInputValue = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

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
  // 細線條、圓角的簡約日曆圖示（與側邊欄收合圖示同一風格）
  button.innerHTML =
    '<svg class="date-field-icon" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
    '<rect x="3" y="4.25" width="14" height="12.5" rx="3" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M3.5 8.25h13M7 2.75v3M13 2.75v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    "</svg>";

  const picker = document.createElement("input");
  picker.type = "datetime-local";
  picker.className = "date-field-picker";
  picker.tabIndex = -1;
  picker.setAttribute("aria-hidden", "true");

  wrapper.append(button, picker);

  button.addEventListener("click", () => {
    const start = parseRocDateTime(input.value) || parseRocDateTime(getFallback()) || new Date();
    picker.value = toLocalInputValue(start);
    try {
      if (typeof picker.showPicker === "function") picker.showPicker();
      else {
        picker.focus();
        picker.click();
      }
    } catch (_error) {
      picker.focus();
      picker.click();
    }
  });

  picker.addEventListener("change", () => {
    if (!picker.value) return;
    const [datePart, timePart = "00:00"] = picker.value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    input.value = formatRocDateTime(new Date(year, month - 1, day, hour, minute));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
  });
  return wrapper;
};
