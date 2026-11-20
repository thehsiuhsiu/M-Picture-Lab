// lineLimitHints.js - 欄位下方的行數提示：超過行數上限時變橘色（見 docs/adr/0005-shared-layout-spec.md）

import { state } from "./state.js?v=20261121-4";
import { PROJECT_CHANGED_EVENT } from "./projectEvents.js?v=20261121-4";
import {
  fieldLines,
  lineLimit,
  generateAccidentTagsText,
} from "./documentLayout.js?v=20261121-4";

// 案件資料欄位：輸入框 id → 欄位與適用版型
const CASE_FIELDS = Object.freeze({
  zipPrefix: { field: "caseReason", formats: "left" },
  caseUni: { field: "caseUnit", formats: "left" },
  caseNumber: { field: "photographer", formats: "left" },
  caseAddress: { field: "address", formats: "left" },
  caseDate: { field: "date", formats: "left middle" },
});

const SELECTOR = `[data-line-field], ${Object.keys(CASE_FIELDS)
  .map((id) => `#${id}`)
  .join(", ")}`;

const describeTarget = (element) => {
  const caseField = CASE_FIELDS[element.id];
  if (caseField) return { ...caseField, text: element.value };
  const { lineField: field, lineFormats: formats = "", imageId } = element.dataset;
  const text =
    element.dataset.lineSource === "accident-tags"
      ? generateAccidentTagsText(state.imageAccidentTags[imageId] || {})
      : element.value;
  return { field, formats, text };
};

const getHint = (element) => {
  const anchor = element.closest(".date-field") || element;
  const next = anchor.nextElementSibling;
  if (next?.classList.contains("line-limit-hint")) return next;
  const hint = document.createElement("p");
  hint.className = "line-limit-hint";
  hint.setAttribute("aria-live", "polite");
  hint.hidden = true;
  anchor.after(hint);
  return hint;
};

/** 更新一個欄位的提示 */
export const updateLineHint = (element) => {
  if (!(element instanceof Element)) return;
  const { field, formats, text } = describeTarget(element);
  const format = state.selectedFormat;
  const hint = getHint(element);
  const applies = Boolean(field) && formats.split(" ").includes(format);
  const lines = applies ? fieldLines(format, field, text) : 0;
  const limit = lineLimit(format, field);
  const over = lines > limit;
  // 說明一律顯示行數；其他欄位只有超過時才提示
  const showCount = field === "description" && format === "left" && lines > 0;
  hint.hidden = !(over || showCount);
  hint.classList.toggle("is-over", over);
  element.classList.toggle("is-over-line-limit", over);
  hint.textContent = over
    ? `約 ${lines} 行，超過 ${limit} 行上限，列印與 PDF 需先精簡`
    : `約 ${lines} 行（上限 ${limit} 行）`;
};

export const refreshAllLineHints = () => {
  document.querySelectorAll(SELECTOR).forEach(updateLineHint);
};

let initialized = false;

export const initLineLimitHints = () => {
  if (initialized) return;
  initialized = true;
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches(SELECTOR)) updateLineHint(target);
    // 「其他」的文字會影響交通事故說明的長度
    if (target.matches(".accident-tag-other-input")) {
      target
        .closest(".image-container")
        ?.querySelectorAll("[data-line-source='accident-tags']")
        .forEach(updateLineHint);
    }
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches(".accident-tag-checkbox")) {
      target
        .closest(".image-container")
        ?.querySelectorAll("[data-line-source='accident-tags']")
        .forEach(updateLineHint);
    }
  });
  // 切換版型時欄寬不同，全部重新計算
  new MutationObserver(refreshAllLineHints).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  document.addEventListener(PROJECT_CHANGED_EVENT, refreshAllLineHints);
  refreshAllLineHints();
};
