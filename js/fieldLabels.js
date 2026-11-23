// fieldLabels.js：案件資料的欄位名稱（網頁上和文件表格裡用同一個名稱，可依專案自訂）

import { state } from "./state.js?v=20261123-1";
import { notifyProjectChanged } from "./projectEvents.js?v=20261123-1";

export const DEFAULT_FIELD_LABELS = Object.freeze({
  caseReason: "案由",
  caseUnit: "單位",
  address: "攝影地址",
  photographer: "攝影人員",
});

export const FIELD_LABEL_KEYS = Object.freeze(Object.keys(DEFAULT_FIELD_LABELS));

/** 文件表格的名稱格一行約放 4 個字 */
export const FIELD_LABEL_MAX_CHARS = 4;

/** 去掉前後空白、最多 4 個字；空白時恢復預設名稱 */
export const normalizeFieldLabel = (key, value) => {
  const text = Array.from(String(value ?? "").trim())
    .slice(0, FIELD_LABEL_MAX_CHARS)
    .join("")
    .trim();
  return text || DEFAULT_FIELD_LABELS[key];
};

export const normalizeFieldLabels = (labels = {}) =>
  Object.fromEntries(
    FIELD_LABEL_KEYS.map((key) => [key, normalizeFieldLabel(key, labels?.[key])]),
  );

export const getFieldLabel = (key) =>
  state.fieldLabels?.[key] || DEFAULT_FIELD_LABELS[key] || "";

// 網頁上顯示各欄位名稱的 <label>
const LABEL_TARGETS = Object.freeze({
  caseReason: "zipPrefix",
  caseUnit: "caseUni",
  address: "caseAddress",
  photographer: "caseNumber",
});

const findLabelText = (key) =>
  document.querySelector(`[data-field-label="${key}"] .field-label-text`);

export const photoAddressPlaceholder = () =>
  `${getFieldLabel("address")}（留空時使用案件資料）`;

const updatePhotoAddressPlaceholders = () => {
  const placeholder = photoAddressPlaceholder();
  document.querySelectorAll(".image-address-input").forEach((input) => {
    input.placeholder = placeholder;
  });
};

const renderLabels = () => {
  FIELD_LABEL_KEYS.forEach((key) => {
    const text = findLabelText(key);
    if (text) text.textContent = getFieldLabel(key);
    const button = document.querySelector(`[data-field-label="${key}"] .field-label-edit`);
    if (button) button.setAttribute("aria-label", `修改欄位名稱「${getFieldLabel(key)}」`);
  });
  updatePhotoAddressPlaceholders();
};

/** 開啟專案、新專案時套用該專案的欄位名稱 */
export const applyFieldLabels = (labels) => {
  state.fieldLabels = normalizeFieldLabels(labels);
  renderLabels();
};

const PENCIL_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>';

const startEditing = (key, row) => {
  if (row.classList.contains("is-editing")) return;
  const label = row.querySelector("label");
  const editButton = row.querySelector(".field-label-edit");
  const original = getFieldLabel(key);
  row.classList.add("is-editing");

  const editor = document.createElement("span");
  editor.className = "field-label-editor";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "field-label-input";
  input.value = original;
  input.maxLength = FIELD_LABEL_MAX_CHARS;
  input.setAttribute("aria-label", `欄位名稱（最多 ${FIELD_LABEL_MAX_CHARS} 個字）`);
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "field-label-reset";
  resetButton.textContent = "預設";
  resetButton.title = `恢復成「${DEFAULT_FIELD_LABELS[key]}」`;
  editor.append(input, resetButton);
  label.hidden = true;
  editButton.hidden = true;
  row.insertBefore(editor, label);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const next = save ? normalizeFieldLabel(key, input.value) : original;
    editor.remove();
    label.hidden = false;
    editButton.hidden = false;
    row.classList.remove("is-editing");
    if (next !== original) {
      state.fieldLabels = { ...normalizeFieldLabels(state.fieldLabels), [key]: next };
      renderLabels();
      notifyProjectChanged();
    }
    editButton.focus({ preventScroll: true });
  };

  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", (event) => {
    if (event.relatedTarget === resetButton) return;
    finish(true);
  });
  resetButton.addEventListener("blur", (event) => {
    if (event.relatedTarget === input) return;
    finish(true);
  });
  resetButton.addEventListener("click", () => {
    input.value = DEFAULT_FIELD_LABELS[key];
    finish(true);
  });

  input.focus();
  input.select();
};

/** 在可自訂的欄位名稱旁加上小鉛筆 */
export const setupFieldLabelEditors = () => {
  if (!state.fieldLabels) state.fieldLabels = normalizeFieldLabels();
  Object.entries(LABEL_TARGETS).forEach(([key, inputId]) => {
    const label = document.querySelector(`label[for="${inputId}"]`);
    if (!label || label.closest("[data-field-label]")) return;
    const row = document.createElement("div");
    row.className = "field-label-row";
    row.dataset.fieldLabel = key;
    label.parentNode.insertBefore(row, label);
    row.appendChild(label);
    label.textContent = "";
    const text = document.createElement("span");
    text.className = "field-label-text";
    label.appendChild(text);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "field-label-edit";
    button.innerHTML = PENCIL_ICON;
    button.addEventListener("click", () => startEditing(key, row));
    row.appendChild(button);
  });
  renderLabels();
};
