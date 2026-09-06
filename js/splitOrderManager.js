import { state } from "./state.js";
import { notifyProjectChanged } from "./projectEvents.js";
import { showToast } from "./utils.js";
import { getPhotoNumber } from "./photoNumbering.js";
import {
  acceptCurrentSplitGroupForImages,
  getSplitGroupIntegrityForImages,
  restoreSplitGroupAtCurrentPositionForImages,
} from "./splitGroupLogic.js";

let dismissedFingerprint = "";

export const getSplitGroupIntegrity = (groupId) =>
  getSplitGroupIntegrityForImages(state.selectedImages, groupId);

export const getSplitOrderIssues = () => {
  const groups = new Map();
  state.selectedImages.forEach((image, position) => {
    if (!image.splitGroupId) return;
    const entries = groups.get(image.splitGroupId) || [];
    entries.push({ image, position });
    groups.set(image.splitGroupId, entries);
  });

  return Array.from(groups.entries()).flatMap(([groupId, entries]) => {
    const integrity = getSplitGroupIntegrity(groupId);
    const { contiguous, ordered, complete, expectedCount } = integrity;
    if (contiguous && ordered && complete) return [];
    return [{
      groupId,
      sourceFileName: entries[0].image.sourceFileName || "長截圖",
      contiguous,
      ordered,
      complete,
      existingCount: entries.length,
      expectedCount,
    }];
  });
};

const syncPreviewOrder = () => {
  const preview = document.getElementById("imagePreview");
  if (!preview) return;
  state.selectedImages.forEach((image, index) => {
    const container = preview.querySelector(
      `.image-container[data-id="${image.id}"]`,
    );
    if (!container) return;
    preview.appendChild(container);
    const counter = container.querySelector(".image-counter");
    if (counter) counter.textContent = String(getPhotoNumber(index));
  });
  state.imageCounter = state.selectedImages.length;
};

const restoreSplitGroupAtCurrentPosition = (groupId) => {
  const restored = restoreSplitGroupAtCurrentPositionForImages(
    state.selectedImages,
    groupId,
  );
  if (restored === state.selectedImages) return false;
  state.selectedImages = restored;
  return true;
};

export const restoreSplitGroup = (groupId) => {
  if (!restoreSplitGroupAtCurrentPosition(groupId)) return;
  syncPreviewOrder();
  dismissedFingerprint = "";
  updateSplitOrderWarning();
  notifyProjectChanged();
  showToast("已恢復此長截圖目前仍存在的分段順序", "success");
};

export const restoreAllOriginalOrder = () => {
  const groupIds = Array.from(
    new Set(state.selectedImages.map((image) => image.splitGroupId).filter(Boolean)),
  );
  groupIds.forEach(restoreSplitGroupAtCurrentPosition);
  syncPreviewOrder();
  dismissedFingerprint = "";
  updateSplitOrderWarning();
  notifyProjectChanged();
  showToast("已恢復各長截圖群組內的分段順序", "success");
};

export const acceptCurrentSplitGroup = (groupId) => {
  const result = acceptCurrentSplitGroupForImages(
    state.selectedImages,
    groupId,
  );
  if (!result.count) return;

  if (!result.released) restoreSplitGroupAtCurrentPosition(groupId);
  syncPreviewOrder();
  dismissedFingerprint = "";
  updateSplitOrderWarning();
  notifyProjectChanged();
  showToast(
    result.released
      ? "僅剩一張分段，已改為一般照片"
      : `已將目前 ${result.count} 張分段設為完整群組`,
    "success",
  );
};

const showIssueDetails = (issues) => {
  const overlay = document.createElement("div");
  overlay.className = "split-order-dialog-overlay";
  const dialog = document.createElement("div");
  dialog.className = "split-order-dialog";
  const title = document.createElement("h2");
  title.textContent = "長截圖順序檢查";
  const list = document.createElement("div");
  list.className = "split-order-issue-list";
  issues.forEach((issue) => {
    const row = document.createElement("div");
    row.className = "split-order-issue-row";
    const text = document.createElement("span");
    const reasons = [
      !issue.ordered && "順序已變更",
      !issue.contiguous && "分段不連續",
      !issue.complete && `缺少分段（${issue.existingCount}/${issue.expectedCount}）`,
    ].filter(Boolean);
    text.textContent = `${issue.sourceFileName}：${reasons.join("、")}`;
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "恢復此長圖順序";
    restore.addEventListener("click", () => {
      restoreSplitGroup(issue.groupId);
      overlay.remove();
    });
    const actions = document.createElement("div");
    actions.className = "split-order-issue-actions";
    actions.appendChild(restore);
    if (!issue.complete) {
      const accept = document.createElement("button");
      accept.type = "button";
      accept.textContent = "接受目前分段";
      accept.addEventListener("click", () => {
        const confirmed = confirm(
          "將目前仍存在的分段視為完整群組並重新編號。已刪除的分段無法復原，確定繼續嗎？",
        );
        if (!confirmed) return;
        acceptCurrentSplitGroup(issue.groupId);
        overlay.remove();
      });
      actions.appendChild(accept);
    }
    row.append(text, actions);
    list.appendChild(row);
  });
  const close = document.createElement("button");
  close.type = "button";
  close.className = "split-order-dialog-close";
  close.textContent = "關閉";
  close.addEventListener("click", () => overlay.remove());
  dialog.append(title, list, close);
  overlay.appendChild(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
};

export const updateSplitOrderWarning = () => {
  const banner = document.getElementById("splitOrderWarning");
  if (!banner) return;
  const issues = getSplitOrderIssues();
  const fingerprint = issues
    .map((issue) => `${issue.groupId}:${issue.ordered}:${issue.contiguous}:${issue.complete}:${issue.existingCount}`)
    .join("|");
  const visible = Boolean(issues.length && fingerprint !== dismissedFingerprint);
  banner.hidden = !visible;
  const message = document.getElementById("splitOrderWarningText");
  if (message) message.textContent = `有 ${issues.length} 組長截圖的順序已變更或不完整`;
  const restoreButton = banner.querySelector("[data-action='restore-all']");
  const reviewButton = banner.querySelector("[data-action='review']");
  const dismissButton = banner.querySelector("[data-action='dismiss']");
  if (restoreButton) restoreButton.onclick = restoreAllOriginalOrder;
  if (reviewButton) reviewButton.onclick = () => showIssueDetails(getSplitOrderIssues());
  if (dismissButton) {
    dismissButton.onclick = () => {
      dismissedFingerprint = fingerprint;
      banner.hidden = true;
    };
  }
};

export const confirmSplitOrderBeforeExport = () => {
  const issues = getSplitOrderIssues();
  if (!issues.length) return Promise.resolve(true);
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "split-order-dialog-overlay";
    overlay.innerHTML = `
      <div class="split-order-dialog" role="dialog" aria-modal="true" aria-labelledby="splitExportTitle">
        <h2 id="splitExportTitle">輸出前檢查長截圖順序</h2>
        <p>部分長截圖的分段順序已變更或不完整，輸出後可能影響閱讀順序。</p>
        <div class="split-order-export-actions">
          <button type="button" data-result="cancel">返回檢查</button>
          <button type="button" data-result="restore">依原始順序排列</button>
          <button type="button" class="primary" data-result="continue">仍然輸出</button>
        </div>
      </div>`;
    overlay.addEventListener("click", (event) => {
      const result = event.target.closest("[data-result]")?.dataset.result;
      if (!result) return;
      if (result === "restore") restoreAllOriginalOrder();
      overlay.remove();
      resolve(result !== "cancel");
    });
    document.body.appendChild(overlay);
  });
};

export const initSplitOrderManager = () => updateSplitOrderWarning();
