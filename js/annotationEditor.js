// annotationEditor.js - 編輯視窗：旋轉、標記（圈選、方框、箭頭、文字、編號、遮蔽）與進入長截圖分割

import { state } from "./state.js?v=20261027-2";
import {
  DEFAULT_COLOR,
  MAX_ANNOTATIONS_PER_IMAGE,
  MAX_LABEL_LENGTH,
  MAX_TEXT_LENGTH,
  createAnnotationId,
  drawAnnotatedImage,
  normalizeAnnotations,
  normalizeColor,
  PRESET_COLORS,
  rotateAnnotations,
} from "./annotations.js?v=20261027-2";
import { showDialog, showToast } from "./utils.js?v=20261027-2";

const TOOL_HINTS = {
  select: "點選標記可移動、改顏色或粗細；拖曳角落可縮放；點兩下文字可修改",
  ellipse: "在照片上拖曳即可畫出圈選",
  rect: "在照片上拖曳即可畫出方框",
  arrow: "從起點拖曳到要指出的位置",
  text: "點一下照片要放文字的位置",
  label: "點一下照片要放編號的位置",
  mask: "拖曳框出要遮蔽的範圍（例如無關民眾的臉、車牌）",
  zoom: "框出要放大的區域，放大框會自動出現在旁邊；用選取工具可拖曳放大框、拉角落改倍率",
};
const BOX_TYPES = new Set(["ellipse", "rect", "mask"]);
const MIN_SHAPE_PX = 6;
const ZOOM_SCALES = [3, 2.5, 2, 1.6, 1.3];
const ZOOM_GAP = 0.03;
const HANDLE_PX = 10;

let session = null;
// save(imageId, annotations, turns)、split(imageId, edits)：由照片模組提供
let handlers = {};

const $ = (id) => document.getElementById(id);

const isTouchPointer = (event) => event.pointerType === "touch" || event.pointerType === "pen";

/* ---------- 開啟與關閉 ---------- */

// 編輯畫面用原圖，但只縮到螢幕看得清楚的大小，避免 4800 萬畫素的照片占用太多記憶體
const EDITOR_MIN_DIMENSION = 2400;
const EDITOR_MAX_DIMENSION = 4096;

const getEditorMaxDimension = () => {
  const screenLongSide = Math.max(window.screen?.width || 0, window.screen?.height || 0);
  const needed = Math.ceil(screenLongSide * (window.devicePixelRatio || 1) * 1.25);
  return Math.min(EDITOR_MAX_DIMENSION, Math.max(EDITOR_MIN_DIMENSION, needed));
};

/** 讀取原圖並縮到編輯所需的大小；回傳 canvas（或原尺寸夠小時的 Image）。 */
const loadEditorSource = async (image) => {
  const url = URL.createObjectURL(image.blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const limit = getEditorMaxDimension();
    const scale = Math.min(1, limit / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** 由照片卡片的「編輯」按鈕呼叫。 */
export const openAnnotationEditor = async (imageId, editorHandlers) => {
  const image = state.selectedImages.find((item) => item.id === imageId);
  if (!image) return;
  let source;
  try {
    source = await loadEditorSource(image);
  } catch (_error) {
    showToast("無法開啟這張照片", "error");
    return;
  }
  handlers = editorHandlers || {};
  const initial = JSON.stringify(state.imageAnnotations[imageId] || []);
  session = {
    imageId,
    originalSource: source,
    source,
    turns: 0, // 尚未套用的旋轉（每單位 90° 順時針），按「完成」才生效
    annotations: JSON.parse(initial),
    initial,
    tool: "ellipse",
    color: DEFAULT_COLOR,
    size: "medium",
    maskStyle: "mosaic",
    connector: true,
    selectedId: null,
    undo: [],
    redo: [],
    boxes: {},
    drag: null,
    editing: null,
    previousFocus: document.activeElement,
  };
  const index = state.selectedImages.indexOf(image);
  const title = $("annotateTitle");
  if (title) title.textContent = `編輯照片 ${index + 1}`;
  const modal = $("annotateModal");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("annotate-open");
  syncControls();
  // 等版面算好再決定畫布大小
  requestAnimationFrame(() => {
    layoutCanvas();
    render();
    $("annotateCloseBtn")?.focus({ preventScroll: true });
  });
};

const closeEditor = () => {
  if (!session) return;
  commitTextInput();
  const modal = $("annotateModal");
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("annotate-open");
  const previousFocus = session.previousFocus;
  session = null;
  if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
};

const hasUnsavedChanges = () =>
  session && (session.turns !== 0 || JSON.stringify(session.annotations) !== session.initial);

const requestCancel = async () => {
  if (!session) return;
  commitTextInput();
  if (hasUnsavedChanges()) {
    const discard = await showDialog({
      title: "放棄這次的修改？",
      message: "旋轉與標記按「完成」才會保存；放棄後會回到開啟前的樣子。",
      tone: "warning",
      confirmText: "放棄修改",
      cancelText: "繼續編輯",
    });
    if (!discard) return;
  }
  closeEditor();
};

const collectEdits = () => {
  commitTextInput();
  const annotations = normalizeAnnotations(
    session.annotations.filter((item) => item.type !== "text" || item.text.trim()),
  );
  return {
    imageId: session.imageId,
    annotations,
    turns: session.turns,
    changed: session.turns !== 0 || JSON.stringify(annotations) !== session.initial,
  };
};

const finish = async () => {
  if (!session) return;
  const edits = collectEdits();
  closeEditor();
  if (edits.changed && handlers.save) {
    await handlers.save(edits.imageId, edits.annotations, edits.turns);
  }
};

/** 「分割」工具：旋轉先套用，接著在同一個全螢幕畫面切換成長截圖分割。 */
const startSplit = async () => {
  if (!session || !handlers.split) return;
  const edits = collectEdits();
  closeEditor();
  await handlers.split(edits.imageId, edits);
};

/** 依尚未套用的旋轉，產生要顯示的照片（原圖不變）。 */
const rebuildSource = () => {
  const original = session.originalSource;
  const turns = ((session.turns % 4) + 4) % 4;
  if (!turns) {
    session.source = original;
    return;
  }
  const width = original.naturalWidth || original.width;
  const height = original.naturalHeight || original.height;
  const canvas = document.createElement("canvas");
  const swap = turns % 2 === 1;
  canvas.width = swap ? height : width;
  canvas.height = swap ? width : height;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(original, -width / 2, -height / 2);
  session.source = canvas;
};

const rotateView = (direction) => {
  if (!session) return;
  commitTextInput();
  pushHistory();
  session.turns = (((session.turns + direction) % 4) + 4) % 4;
  session.annotations = rotateAnnotations(session.annotations, direction * 90);
  rebuildSource();
  layoutCanvas();
  syncControls();
  render();
};

/* ---------- 畫布大小與座標 ---------- */

const layoutCanvas = () => {
  if (!session) return;
  const stage = $("annotateStage");
  const canvas = $("annotateCanvas");
  const wrap = $("annotateCanvasWrap");
  const styles = getComputedStyle(stage);
  const availableWidth =
    stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
  const availableHeight =
    stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
  const naturalWidth = session.source.naturalWidth || session.source.width;
  const naturalHeight = session.source.naturalHeight || session.source.height;
  const scale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight);
  const width = Math.max(1, Math.floor(naturalWidth * scale));
  const height = Math.max(1, Math.floor(naturalHeight * scale));
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  wrap.style.width = `${width}px`;
  wrap.style.height = `${height}px`;
  session.view = { width, height, ratio };
};

const toRatio = (event) => {
  const rect = $("annotateCanvas").getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
};

/* ---------- 繪製 ---------- */

const getSelected = () =>
  session?.annotations.find((item) => item.id === session.selectedId) || null;

/* ---------- 局部放大 ---------- */

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const sourceBoxOf = (item) => ({ x: item.sx, y: item.sy, w: item.sw, h: item.sh });
const targetBoxOf = (item) => ({ x: item.x, y: item.y, w: item.w, h: item.h });

const insideBox = (point, box, toleranceX, toleranceY) =>
  point.x >= box.x - toleranceX &&
  point.x <= box.x + box.w + toleranceX &&
  point.y >= box.y - toleranceY &&
  point.y <= box.y + box.h + toleranceY;

/** 放大框的寬高比必須和來源框一樣（比例座標下 w/h = sw/sh）。 */
const fitTargetToSource = (item, anchor = "nw") => {
  const ratio = item.sh / item.sw;
  let w = item.w;
  let h = w * ratio;
  const maxW = anchor.includes("w") ? item.x + item.w : 1 - item.x;
  const maxH = anchor.includes("n") ? item.y + item.h : 1 - item.y;
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }
  if (w > maxW) {
    w = maxW;
    h = w * ratio;
  }
  if (anchor.includes("w")) item.x = item.x + item.w - w;
  if (anchor.includes("n")) item.y = item.y + item.h - h;
  item.w = w;
  item.h = h;
};

/** 自動把放大框放在來源框旁最寬的一側，倍率從約 3 倍開始，放不下就縮小。 */
const placeTarget = (item) => {
  const { sx, sy, sw, sh } = item;
  const sides = [
    { side: "right", room: 1 - (sx + sw) },
    { side: "left", room: sx },
    { side: "below", room: 1 - (sy + sh) },
    { side: "above", room: sy },
  ].sort((a, b) => b.room - a.room);
  for (const scale of ZOOM_SCALES) {
    const w = sw * scale;
    const h = sh * scale;
    if (w > 0.96 || h > 0.96) continue;
    for (const { side } of sides) {
      let x;
      let y;
      if (side === "right" || side === "left") {
        x = side === "right" ? sx + sw + ZOOM_GAP : sx - ZOOM_GAP - w;
        y = Math.min(1 - h, Math.max(0, sy + sh / 2 - h / 2));
      } else {
        y = side === "below" ? sy + sh + ZOOM_GAP : sy - ZOOM_GAP - h;
        x = Math.min(1 - w, Math.max(0, sx + sw / 2 - w / 2));
      }
      if (x >= 0 && y >= 0 && x + w <= 1 && y + h <= 1) {
        Object.assign(item, { x, y, w, h });
        return;
      }
    }
  }
  // 照片太小或來源框太大：放在對角的角落，盡量不重疊
  const scale = Math.min(1.3, 0.45 / Math.max(sw, sh));
  const w = sw * scale;
  const h = sh * scale;
  const x = sx + sw / 2 > 0.5 ? 0.02 : 0.98 - w;
  const y = sy + sh / 2 > 0.5 ? 0.02 : 0.98 - h;
  Object.assign(item, { x: clamp01(x), y: clamp01(y), w, h });
};

const zoomPartAt = (item, point, tolerance) => {
  const { width, height } = session.view;
  const tx = tolerance / width;
  const ty = tolerance / height;
  if (insideBox(point, targetBoxOf(item), tx, ty)) return "target";
  if (insideBox(point, sourceBoxOf(item), tx, ty)) return "source";
  return null;
};

const boundsOf = (item) => {
  if (item.type === "zoom") return targetBoxOf(item);
  if (BOX_TYPES.has(item.type)) return { x: item.x, y: item.y, w: item.w, h: item.h };
  if (item.type === "arrow") {
    return {
      x: Math.min(item.x1, item.x2),
      y: Math.min(item.y1, item.y2),
      w: Math.abs(item.x2 - item.x1),
      h: Math.abs(item.y2 - item.y1),
    };
  }
  return session.boxes[item.id] || { x: item.x, y: item.y, w: 0, h: 0 };
};

const handlesOf = (item) => {
  if (item.type === "zoom") {
    const corners = (box, prefix) => [
      { key: `${prefix}nw`, x: box.x, y: box.y },
      { key: `${prefix}ne`, x: box.x + box.w, y: box.y },
      { key: `${prefix}sw`, x: box.x, y: box.y + box.h },
      { key: `${prefix}se`, x: box.x + box.w, y: box.y + box.h },
    ];
    return [...corners(targetBoxOf(item), "t-"), ...corners(sourceBoxOf(item), "s-")];
  }
  if (item.type === "arrow") {
    return [
      { key: "start", x: item.x1, y: item.y1 },
      { key: "end", x: item.x2, y: item.y2 },
    ];
  }
  if (!BOX_TYPES.has(item.type)) return [];
  return [
    { key: "nw", x: item.x, y: item.y },
    { key: "ne", x: item.x + item.w, y: item.y },
    { key: "sw", x: item.x, y: item.y + item.h },
    { key: "se", x: item.x + item.w, y: item.y + item.h },
  ];
};

/** 照片先縮成畫布實際像素大小並保留，拖曳重畫時直接貼上，不必每次從原圖縮放。 */
const getDisplayBackground = (pixelWidth, pixelHeight) => {
  const cached = session.displayBackground;
  if (cached && cached.source === session.source && cached.canvas.width === pixelWidth && cached.canvas.height === pixelHeight) {
    return cached.canvas;
  }
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(session.source, 0, 0, pixelWidth, pixelHeight);
  session.displayBackground = { source: session.source, canvas };
  return canvas;
};

const render = () => {
  if (!session?.view) return;
  const canvas = $("annotateCanvas");
  const ctx = canvas.getContext("2d");
  const { width, height, ratio } = session.view;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  // 正在輸入的文字先不畫，避免和輸入框重疊
  const visible = session.annotations.filter((item) => item.id !== session.editing?.id);
  session.boxes = drawAnnotatedImage(ctx, session.source, visible, width, height, {
    cacheZoomBase: true,
    background: getDisplayBackground(canvas.width, canvas.height),
  });

  const selected = getSelected();
  if (selected && selected.id !== session.editing?.id) {
    const outlines =
      selected.type === "zoom" ? [targetBoxOf(selected), sourceBoxOf(selected)] : [boundsOf(selected)];
    ctx.save();
    outlines.forEach((b) => {
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#1f1e1d";
      ctx.strokeRect(b.x * width - 6, b.y * height - 6, b.w * width + 12, b.h * height + 12);
      ctx.setLineDash([]);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.75;
      ctx.strokeRect(b.x * width - 7, b.y * height - 7, b.w * width + 14, b.h * height + 14);
    });
    handlesOf(selected).forEach((handle) => {
      const hx = handle.x * width - HANDLE_PX / 2;
      const hy = handle.y * height - HANDLE_PX / 2;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(hx, hy, HANDLE_PX, HANDLE_PX);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1f1e1d";
      ctx.strokeRect(hx, hy, HANDLE_PX, HANDLE_PX);
    });
    ctx.restore();
  }
  syncFooter();
};

/* ---------- 點選判斷 ---------- */

const distanceToSegment = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

const hitHandle = (point, tolerance) => {
  const selected = getSelected();
  if (!selected) return null;
  const { width, height } = session.view;
  return (
    handlesOf(selected).find(
      (handle) =>
        Math.abs(handle.x * width - point.x * width) <= tolerance &&
        Math.abs(handle.y * height - point.y * height) <= tolerance,
    ) || null
  );
};

const hitAnnotation = (point, tolerance) => {
  const { width, height } = session.view;
  const px = point.x * width;
  const py = point.y * height;
  // 由上層往下找，最後畫的優先
  for (let index = session.annotations.length - 1; index >= 0; index -= 1) {
    const item = session.annotations[index];
    if (item.type === "zoom") {
      if (zoomPartAt(item, point, tolerance)) return item;
      continue;
    }
    if (item.type === "arrow") {
      const distance = distanceToSegment(
        px, py, item.x1 * width, item.y1 * height, item.x2 * width, item.y2 * height,
      );
      if (distance <= tolerance) return item;
      continue;
    }
    const b = boundsOf(item);
    if (
      px >= b.x * width - tolerance &&
      px <= (b.x + b.w) * width + tolerance &&
      py >= b.y * height - tolerance &&
      py <= (b.y + b.h) * height + tolerance
    ) {
      return item;
    }
  }
  return null;
};

/* ---------- 修改與復原 ---------- */

const snapshot = () => JSON.stringify({ a: session.annotations, t: session.turns });

const restoreSnapshot = (value) => {
  const data = JSON.parse(value);
  const turnsChanged = data.t !== session.turns;
  session.annotations = data.a;
  session.turns = data.t;
  if (turnsChanged) {
    rebuildSource();
    layoutCanvas();
  }
};

const pushHistory = () => {
  session.undo.push(snapshot());
  if (session.undo.length > 100) session.undo.shift();
  session.redo = [];
};

const undo = () => {
  if (!session?.undo.length) return;
  commitTextInput();
  session.redo.push(snapshot());
  restoreSnapshot(session.undo.pop());
  if (!getSelected()) session.selectedId = null;
  syncControls();
  render();
};

const redo = () => {
  if (!session?.redo.length) return;
  commitTextInput();
  session.undo.push(snapshot());
  restoreSnapshot(session.redo.pop());
  if (!getSelected()) session.selectedId = null;
  syncControls();
  render();
};

const deleteSelected = () => {
  const selected = getSelected();
  if (!selected) return;
  pushHistory();
  session.annotations = session.annotations.filter((item) => item !== selected);
  session.selectedId = null;
  syncControls();
  render();
};

const clearAll = async () => {
  if (!session?.annotations.length) return;
  commitTextInput();
  const confirmed = await showDialog({
    title: "移除這張照片的全部標記？",
    message: "可以按「復原」救回來；按「完成」後才會保存。",
    tone: "warning",
    confirmText: "全部移除",
    cancelText: "取消",
  });
  if (!confirmed || !session) return;
  pushHistory();
  session.annotations = [];
  session.selectedId = null;
  syncControls();
  render();
};

const canAddMore = () => {
  if (session.annotations.length < MAX_ANNOTATIONS_PER_IMAGE) return true;
  showToast(`每張照片最多 ${MAX_ANNOTATIONS_PER_IMAGE} 個標記`, "warning");
  return false;
};

const nextLabelText = () => {
  const numbers = session.annotations
    .filter((item) => item.type === "label")
    .map((item) => Number.parseInt(item.text, 10))
    .filter(Number.isFinite);
  return String(numbers.length ? Math.max(...numbers) + 1 : 1).slice(0, MAX_LABEL_LENGTH);
};

/** 修改選取中的標記樣式（顏色、粗細、遮蔽方式），同時記住為之後的預設。 */
const applyStyle = (key, value) => {
  session[key] = value;
  // 畫圖工具下換顏色只是改下一個標記的顏色；要改已畫好的標記，請用「選取」工具點選它
  // 連接線開關例外：剛畫好的局部放大也能直接切換
  if (session.tool !== "select" && !(key === "connector" && getSelected()?.type === "zoom")) {
    if (session.selectedId) {
      session.selectedId = null;
      render();
    }
    syncControls();
    return;
  }
  const selected = getSelected();
  const field = key === "maskStyle" ? "style" : key;
  const applies =
    (key !== "maskStyle" || selected?.type === "mask") &&
    (key !== "connector" || selected?.type === "zoom");
  if (selected && applies && selected[field] !== value) {
    if (key === "size" && selected.type === "mask") {
      syncControls();
      return;
    }
    pushHistory();
    selected[field] = value;
    render();
  }
  syncControls();
};

/* ---------- 文字與編號輸入 ---------- */

const openTextInput = (item, { isNew }) => {
  const input = $("annotateTextInput");
  const { width, height } = session.view;
  session.editing = { id: item.id, isNew, before: isNew ? null : snapshot() };
  input.hidden = false;
  input.maxLength = item.type === "label" ? MAX_LABEL_LENGTH : MAX_TEXT_LENGTH;
  input.value = item.text || "";
  input.classList.toggle("is-label", item.type === "label");
  input.style.color = normalizeColor(item.color);
  if (item.type === "label") {
    input.style.left = `${item.x * width - 30}px`;
    input.style.top = `${item.y * height - 18}px`;
  } else {
    input.style.left = `${Math.min(item.x * width, width - 120)}px`;
    input.style.top = `${Math.min(item.y * height, height - 40)}px`;
  }
  input.placeholder = item.type === "label" ? "編號" : "輸入文字";
  render();
  input.focus();
  input.select();
};

const commitTextInput = ({ cancel = false } = {}) => {
  if (!session?.editing) return;
  const input = $("annotateTextInput");
  const { id, isNew, before } = session.editing;
  const item = session.annotations.find((annotation) => annotation.id === id);
  session.editing = null;
  input.hidden = true;
  if (!item) return render();
  const value = input.value.trim();
  if (cancel || !value) {
    if (isNew) {
      // 新增時取消或沒輸入：當作沒有新增
      session.annotations = session.annotations.filter((annotation) => annotation !== item);
      session.undo.pop();
      session.selectedId = null;
    } else if (!value) {
      session.annotations = session.annotations.filter((annotation) => annotation !== item);
      session.selectedId = null;
    }
  } else if (value !== item.text) {
    if (!isNew && before) {
      session.undo.push(before);
      session.redo = [];
    }
    item.text = value;
  }
  syncControls();
  render();
};

/* ---------- 指標操作 ---------- */

const onPointerDown = (event) => {
  if (!session || event.button > 0) return;
  if (session.editing) {
    commitTextInput();
    return;
  }
  const canvas = $("annotateCanvas");
  const point = toRatio(event);
  const tolerance = isTouchPointer(event) ? 16 : 8;

  // 選取中的標記：任何工具都可以拖曳控制點縮放
  const handle = hitHandle(point, tolerance);
  if (handle) {
    const selected = getSelected();
    session.drag = { mode: "resize", handle: handle.key, before: snapshot(), item: selected };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }

  const tool = session.tool;
  if (tool === "select") {
    const hit = hitAnnotation(point, tolerance);
    session.selectedId = hit?.id || null;
    if (hit) {
      session.drag = {
        mode: "move",
        part: hit.type === "zoom" ? zoomPartAt(hit, point, tolerance) : null,
        start: point,
        before: snapshot(),
        original: JSON.parse(JSON.stringify(hit)),
        item: hit,
      };
      canvas.setPointerCapture(event.pointerId);
    }
    syncControls();
    render();
    event.preventDefault();
    return;
  }

  if (tool === "text" || tool === "label") {
    if (!canAddMore()) return;
    pushHistory();
    const item = {
      id: createAnnotationId(),
      type: tool,
      x: point.x,
      y: point.y,
      text: tool === "label" ? nextLabelText() : "",
      color: session.color,
      size: session.size,
    };
    session.annotations.push(item);
    session.selectedId = item.id;
    syncControls();
    event.preventDefault();
    // 等這次點擊結束再顯示輸入框，避免立刻失去焦點
    setTimeout(() => openTextInput(item, { isNew: true }), 0);
    return;
  }

  if (!canAddMore()) return;
  if (tool === "zoom") {
    const zoom = {
      id: createAnnotationId(),
      type: "zoom",
      sx: point.x,
      sy: point.y,
      sw: 0,
      sh: 0,
      x: point.x,
      y: point.y,
      w: 0,
      h: 0,
      color: session.color,
      size: session.size,
      connector: session.connector,
    };
    session.drag = { mode: "create", start: point, before: snapshot(), item: zoom };
    session.annotations.push(zoom);
    session.selectedId = zoom.id;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  const item =
    tool === "arrow"
      ? { id: createAnnotationId(), type: "arrow", x1: point.x, y1: point.y, x2: point.x, y2: point.y }
      : { id: createAnnotationId(), type: tool, x: point.x, y: point.y, w: 0, h: 0 };
  item.color = session.color;
  item.size = session.size;
  if (tool === "mask") item.style = session.maskStyle;
  session.drag = { mode: "create", start: point, before: snapshot(), item };
  session.annotations.push(item);
  session.selectedId = item.id;
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
  render();
};

const setBox = (item, ax, ay, bx, by) => {
  item.x = Math.min(ax, bx);
  item.y = Math.min(ay, by);
  item.w = Math.abs(bx - ax);
  item.h = Math.abs(by - ay);
};

const onPointerMove = (event) => {
  const drag = session?.drag;
  if (!drag) return;
  const point = toRatio(event);
  const { item } = drag;
  if (drag.mode === "create" && item.type === "zoom") {
    item.sx = Math.min(drag.start.x, point.x);
    item.sy = Math.min(drag.start.y, point.y);
    item.sw = Math.abs(point.x - drag.start.x);
    item.sh = Math.abs(point.y - drag.start.y);
    if (item.sw > 0.002 && item.sh > 0.002) placeTarget(item);
  } else if (drag.mode === "move" && item.type === "zoom") {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const o = drag.original;
    if (drag.part === "source") {
      item.sx = Math.min(1 - o.sw, Math.max(0, o.sx + dx));
      item.sy = Math.min(1 - o.sh, Math.max(0, o.sy + dy));
    } else {
      item.x = Math.min(1 - o.w, Math.max(0, o.x + dx));
      item.y = Math.min(1 - o.h, Math.max(0, o.y + dy));
    }
  } else if (drag.mode === "resize" && item.type === "zoom") {
    const [part, corner] = drag.handle.split("-");
    if (part === "s") {
      // 來源框可以自由改形狀；放大框保留寬度與左上角，高度跟著比例調整
      const right = item.sx + item.sw;
      const bottom = item.sy + item.sh;
      const anchorX = corner.includes("w") ? right : item.sx;
      const anchorY = corner.includes("n") ? bottom : item.sy;
      item.sx = Math.min(anchorX, point.x);
      item.sy = Math.min(anchorY, point.y);
      item.sw = Math.max(0.005, Math.abs(point.x - anchorX));
      item.sh = Math.max(0.005, Math.abs(point.y - anchorY));
      fitTargetToSource(item, "se");
    } else {
      // 放大框：比例固定，拉角落就是改倍率
      const right = item.x + item.w;
      const bottom = item.y + item.h;
      const anchorX = corner.includes("w") ? right : item.x;
      const anchorY = corner.includes("n") ? bottom : item.y;
      const ratio = item.sh / item.sw;
      let w = Math.max(item.sw, Math.abs(point.x - anchorX));
      w = Math.max(w, Math.abs(point.y - anchorY) / ratio);
      const opposite = corner.includes("w") ? "w" : "e";
      const vertical = corner.includes("n") ? "n" : "s";
      item.w = w;
      item.h = w * ratio;
      item.x = opposite === "w" ? anchorX - w : anchorX;
      item.y = vertical === "n" ? anchorY - item.h : anchorY;
      // 超出照片時縮回來
      if (item.x < 0 || item.y < 0 || item.x + item.w > 1 || item.y + item.h > 1) {
        const maxW = opposite === "w" ? anchorX : 1 - anchorX;
        const maxH = vertical === "n" ? anchorY : 1 - anchorY;
        const fitted = Math.min(maxW, maxH / ratio);
        item.w = fitted;
        item.h = fitted * ratio;
        item.x = opposite === "w" ? anchorX - fitted : anchorX;
        item.y = vertical === "n" ? anchorY - item.h : anchorY;
      }
    }
  } else if (drag.mode === "create") {
    if (item.type === "arrow") {
      item.x2 = point.x;
      item.y2 = point.y;
    } else {
      setBox(item, drag.start.x, drag.start.y, point.x, point.y);
    }
  } else if (drag.mode === "move") {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const o = drag.original;
    const clamp = (value) => Math.min(1, Math.max(0, value));
    if (item.type === "arrow") {
      const minX = Math.min(o.x1, o.x2);
      const maxX = Math.max(o.x1, o.x2);
      const minY = Math.min(o.y1, o.y2);
      const maxY = Math.max(o.y1, o.y2);
      const sx = Math.min(1 - maxX, Math.max(-minX, dx));
      const sy = Math.min(1 - maxY, Math.max(-minY, dy));
      item.x1 = o.x1 + sx;
      item.x2 = o.x2 + sx;
      item.y1 = o.y1 + sy;
      item.y2 = o.y2 + sy;
    } else if (BOX_TYPES.has(item.type)) {
      item.x = Math.min(1 - o.w, Math.max(0, o.x + dx));
      item.y = Math.min(1 - o.h, Math.max(0, o.y + dy));
    } else {
      item.x = clamp(o.x + dx);
      item.y = clamp(o.y + dy);
    }
  } else if (drag.mode === "resize") {
    if (item.type === "arrow") {
      if (drag.handle === "start") {
        item.x1 = point.x;
        item.y1 = point.y;
      } else {
        item.x2 = point.x;
        item.y2 = point.y;
      }
    } else {
      const left = item.x;
      const top = item.y;
      const right = item.x + item.w;
      const bottom = item.y + item.h;
      const anchorX = drag.handle.includes("w") ? right : left;
      const anchorY = drag.handle.includes("n") ? bottom : top;
      setBox(item, anchorX, anchorY, point.x, point.y);
    }
  }
  drag.moved = true;
  render();
};

const onPointerUp = () => {
  const drag = session?.drag;
  if (!drag) return;
  session.drag = null;
  const { item } = drag;
  const { width, height } = session.view;
  if (drag.mode === "create") {
    const tooSmall =
      item.type === "zoom"
        ? item.sw * width < MIN_SHAPE_PX || item.sh * height < MIN_SHAPE_PX
        : item.type === "arrow"
        ? Math.hypot((item.x2 - item.x1) * width, (item.y2 - item.y1) * height) < MIN_SHAPE_PX * 2
        : item.w * width < MIN_SHAPE_PX || item.h * height < MIN_SHAPE_PX;
    if (tooSmall) {
      // 只是點一下：不新增
      session.annotations = session.annotations.filter((annotation) => annotation !== item);
      session.selectedId = null;
      showToast(
        item.type === "arrow" ? "請從起點拖曳到要指出的位置" : "請在照片上拖曳畫出範圍",
        "info",
        2000,
      );
    } else {
      session.undo.push(drag.before);
      session.redo = [];
    }
  } else if (drag.moved && drag.before !== snapshot()) {
    session.undo.push(drag.before);
    session.redo = [];
  }
  syncControls();
  render();
};

const onDoubleClick = (event) => {
  if (!session || session.editing) return;
  const hit = hitAnnotation(toRatio(event), 8);
  if (hit && (hit.type === "text" || hit.type === "label")) {
    session.selectedId = hit.id;
    openTextInput(hit, { isNew: false });
  }
};

/* ---------- 介面狀態 ---------- */

const setTool = (tool) => {
  commitTextInput();
  session.tool = tool;
  if (tool !== "select") {
    const selected = getSelected();
    if (selected && selected.type !== tool) session.selectedId = null;
  }
  syncControls();
  render();
};

const syncControls = () => {
  if (!session) return;
  const selected = getSelected();
  document.querySelectorAll("[data-annotate-tool]").forEach((button) => {
    const active = button.dataset.annotateTool === session.tool;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const color = normalizeColor(selected?.color || session.color);
  let matchedPreset = false;
  document.querySelectorAll("[data-annotate-color]").forEach((button) => {
    const checked = button.dataset.annotateColor === color;
    matchedPreset ||= checked;
    button.setAttribute("aria-checked", String(checked));
  });
  const custom = $("annotateCustomSwatch");
  if (custom) {
    custom.setAttribute("aria-checked", String(!matchedPreset));
    custom.classList.toggle("has-color", !matchedPreset);
    custom.style.setProperty("--chosen-color", matchedPreset ? "#ffffff" : color);
    const picker = $("annotateCustomColor");
    if (picker && !matchedPreset) picker.value = color;
  }
  const size = selected?.size || session.size;
  document.querySelectorAll("[data-annotate-size]").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.annotateSize === size));
  });
  const showMask = session.tool === "mask" || selected?.type === "mask";
  const maskStyle = selected?.type === "mask" ? selected.style : session.maskStyle;
  $("annotateMaskGroup").hidden = !showMask;
  $("annotateSizeGroup").hidden = showMask;
  document.querySelectorAll("[data-annotate-mask]").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.annotateMask === maskStyle));
  });
  const showConnector = session.tool === "zoom" || selected?.type === "zoom";
  const connectorGroup = $("annotateConnectorGroup");
  if (connectorGroup) connectorGroup.hidden = !showConnector;
  const connectorSwitch = $("annotateConnectorSwitch");
  if (connectorSwitch) {
    connectorSwitch.checked = selected?.type === "zoom" ? selected.connector !== false : session.connector;
  }
  const hint = $("annotateHint");
  if (hint) hint.textContent = TOOL_HINTS[session.tool] || "";
  $("annotateDeleteBtn").disabled = !selected;
  $("annotateUndoBtn").disabled = !session.undo.length;
  $("annotateRedoBtn").disabled = !session.redo.length;
  $("annotateCanvas").dataset.tool = session.tool;
};

const syncFooter = () => {
  const count = session.annotations.length;
  $("annotateCount").textContent = `${count} 個標記`;
  $("annotateClearBtn").disabled = count === 0;
};

/* ---------- 初始化 ---------- */

export const initAnnotationEditor = () => {
  const modal = $("annotateModal");
  const canvas = $("annotateCanvas");
  if (!modal || !canvas) return;

  document.querySelectorAll("[data-annotate-tool]").forEach((button) =>
    button.addEventListener("click", () => setTool(button.dataset.annotateTool)),
  );
  document.querySelectorAll("[data-annotate-color]").forEach((button) =>
    button.addEventListener("click", () => applyStyle("color", button.dataset.annotateColor)),
  );
  document.querySelectorAll("[data-annotate-size]").forEach((button) =>
    button.addEventListener("click", () => applyStyle("size", button.dataset.annotateSize)),
  );
  document.querySelectorAll("[data-annotate-mask]").forEach((button) =>
    button.addEventListener("click", () => applyStyle("maskStyle", button.dataset.annotateMask)),
  );

  // 自訂顏色：從色盤選完（change）才套用，避免拖曳色盤時記下一大串復原步驟
  $("annotateCustomColor")?.addEventListener("change", (event) =>
    applyStyle("color", normalizeColor(event.target.value)),
  );
  document.querySelectorAll("[data-annotate-action]").forEach((button) =>
    button.addEventListener("click", () => {
      const action = button.dataset.annotateAction;
      if (action === "rotate-left") rotateView(-1);
      else if (action === "rotate-right") rotateView(1);
      else if (action === "split") startSplit();
    }),
  );
  $("annotateConnectorSwitch")?.addEventListener("change", (event) =>
    applyStyle("connector", event.target.checked),
  );
  $("annotateUndoBtn").addEventListener("click", undo);
  $("annotateRedoBtn").addEventListener("click", redo);
  $("annotateDeleteBtn").addEventListener("click", deleteSelected);
  $("annotateClearBtn").addEventListener("click", clearAll);
  ["annotateCloseBtn", "annotateCancelBtn", "annotateCancelTopBtn"].forEach((id) =>
    $(id)?.addEventListener("click", requestCancel),
  );
  ["annotateDoneBtn", "annotateDoneTopBtn"].forEach((id) =>
    $(id)?.addEventListener("click", finish),
  );

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("dblclick", onDoubleClick);

  const input = $("annotateTextInput");
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      commitTextInput({ cancel: true });
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitTextInput();
    }
  });
  input.addEventListener("blur", () => commitTextInput());

  document.addEventListener("keydown", (event) => {
    if (!session || modal.getAttribute("aria-hidden") !== "false") return;
    if (document.querySelector(".app-dialog-overlay.show")) return;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (typing) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();
      redo();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (getSelected()) {
        event.preventDefault();
        deleteSelected();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (session.selectedId) {
        session.selectedId = null;
        syncControls();
        render();
      } else {
        requestCancel();
      }
    }
  });

  window.addEventListener("resize", () => {
    if (!session) return;
    commitTextInput();
    layoutCanvas();
    render();
  });
};
