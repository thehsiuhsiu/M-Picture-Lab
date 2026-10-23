// annotations.js - 照片標記：資料格式、檢查、繪製與合成
//
// 標記與原圖分開保存（見 docs/adr/0002-non-destructive-annotations.md）。
// 座標一律存成「相對於照片寬高的比例」（0～1），照片縮放或旋轉時不必換算像素。

import { state } from "./state.js?v=20261023-13";
import { createObjectUrl, revokeObjectUrl } from "./utils.js?v=20261023-13";

export const ANNOTATION_TYPES = Object.freeze([
  "ellipse",
  "rect",
  "arrow",
  "text",
  "label",
  "mask",
  "zoom",
]);
/** 常用色票（編輯視窗上方那一排）；也可以從色盤自訂任何顏色。 */
export const PRESET_COLORS = Object.freeze([
  { key: "red", label: "紅色", hex: "#ff3b30" },
  { key: "orange", label: "橙色", hex: "#ff9500" },
  { key: "yellow", label: "黃色", hex: "#ffd60a" },
  { key: "green", label: "綠色", hex: "#34c759" },
  { key: "blue", label: "藍色", hex: "#0a84ff" },
  { key: "purple", label: "紫色", hex: "#bf5af2" },
  { key: "white", label: "白色", hex: "#ffffff" },
  { key: "black", label: "黑色", hex: "#1f1e1d" },
]);
export const DEFAULT_COLOR = "#ff3b30";
const COLOR_BY_KEY = Object.fromEntries(PRESET_COLORS.map((color) => [color.key, color.hex]));

/** 標記顏色一律存成 #rrggbb；舊版的顏色名稱（red、yellow…）自動轉換。 */
export const normalizeColor = (value) => {
  if (typeof value !== "string") return DEFAULT_COLOR;
  if (COLOR_BY_KEY[value]) return COLOR_BY_KEY[value];
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_COLOR;
};

/** 顏色是否偏亮（決定外框線與編號文字要用深色還是白色）。 */
export const isLightColor = (hex) => {
  const value = normalizeColor(hex);
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 186;
};
export const ANNOTATION_SIZES = Object.freeze(["thin", "medium", "thick"]);
export const MASK_STYLES = Object.freeze(["mosaic", "black"]);
export const MAX_ANNOTATIONS_PER_IMAGE = 200;
export const MAX_TEXT_LENGTH = 100;
export const MAX_LABEL_LENGTH = 3;

const STROKE_RATIO = { thin: 0.002, medium: 0.0035, thick: 0.0055 };
const FONT_RATIO = { thin: 0.03, medium: 0.042, thick: 0.058 };
const LABEL_RATIO = { thin: 0.045, medium: 0.06, thick: 0.08 };
const FONT_FAMILY = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const DISPLAY_MAX_DIMENSION = 1400;

/* ---------- 資料檢查（讀取專案或加密專案檔時使用） ---------- */

const clampRatio = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}不是有效的數字`);
  return Math.min(1, Math.max(0, number));
};

const pickEnum = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

const cleanText = (value, maxLength) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, maxLength);

/** 把不明來源的標記資料整理成安全、可繪製的格式；格式錯誤時丟出錯誤。 */
export const normalizeAnnotations = (raw) => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("照片標記格式無效");
  if (raw.length > MAX_ANNOTATIONS_PER_IMAGE) throw new Error("照片標記數量超過限制");
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 個標記格式無效`);
    }
    const type = item.type;
    if (!ANNOTATION_TYPES.includes(type)) throw new Error("不支援的標記種類");
    const base = {
      id: cleanText(item.id || `a${index}`, 40) || `a${index}`,
      type,
      color: normalizeColor(item.color),
      size: pickEnum(item.size, ANNOTATION_SIZES, "medium"),
    };
    if (type === "arrow") {
      return {
        ...base,
        x1: clampRatio(item.x1, "箭頭起點"),
        y1: clampRatio(item.y1, "箭頭起點"),
        x2: clampRatio(item.x2, "箭頭終點"),
        y2: clampRatio(item.y2, "箭頭終點"),
      };
    }
    if (type === "zoom") {
      // 局部放大：s* 是來源框，x/y/w/h 是放大框（兩者寬高比相同）
      const sx = clampRatio(item.sx, "來源框位置");
      const sy = clampRatio(item.sy, "來源框位置");
      const x = clampRatio(item.x, "放大框位置");
      const y = clampRatio(item.y, "放大框位置");
      return {
        ...base,
        sx,
        sy,
        sw: Math.max(0.001, Math.min(1 - sx, clampRatio(item.sw, "來源框寬度"))),
        sh: Math.max(0.001, Math.min(1 - sy, clampRatio(item.sh, "來源框高度"))),
        x,
        y,
        w: Math.max(0.001, Math.min(1 - x, clampRatio(item.w, "放大框寬度"))),
        h: Math.max(0.001, Math.min(1 - y, clampRatio(item.h, "放大框高度"))),
        connector: item.connector !== false,
      };
    }
    if (type === "text" || type === "label") {
      const maxLength = type === "label" ? MAX_LABEL_LENGTH : MAX_TEXT_LENGTH;
      return {
        ...base,
        x: clampRatio(item.x, "標記位置"),
        y: clampRatio(item.y, "標記位置"),
        text: cleanText(item.text, maxLength),
      };
    }
    const x = clampRatio(item.x, "標記位置");
    const y = clampRatio(item.y, "標記位置");
    const result = {
      ...base,
      x,
      y,
      w: Math.min(1 - x, clampRatio(item.w, "標記寬度")),
      h: Math.min(1 - y, clampRatio(item.h, "標記高度")),
    };
    if (type === "mask") result.style = pickEnum(item.style, MASK_STYLES, "mosaic");
    return result;
  });
};

export const getAnnotations = (imageId) => state.imageAnnotations[imageId] || [];
export const hasAnnotations = (imageId) => getAnnotations(imageId).length > 0;

/* ---------- 繪製 ---------- */

const metricsFor = (width, height) => {
  const base = Math.max(width, height);
  return {
    base,
    stroke: (size) => Math.max(1.5, base * STROKE_RATIO[size]),
    font: (size) => Math.max(12, base * FONT_RATIO[size]),
    label: (size) => Math.max(18, base * LABEL_RATIO[size]),
  };
};

const contrastingInk = (color) => (isLightColor(color) ? "#1f1e1d" : "#ffffff");
const outlineFor = (color) => (isLightColor(color) ? "#1f1e1d" : "#ffffff");

const drawMask = (ctx, source, item, width, height, metrics) => {
  const x = Math.round(item.x * width);
  const y = Math.round(item.y * height);
  const w = Math.max(1, Math.round(item.w * width));
  const h = Math.max(1, Math.round(item.h * height));
  if (item.style === "black") {
    ctx.fillStyle = "#000000";
    ctx.fillRect(x, y, w, h);
    return;
  }
  // 馬賽克：格子大小依照片尺寸決定（至少 8px），縮小再放大，輸出後無法還原
  const block = Math.max(8, Math.round(metrics.base / 45));
  const smallWidth = Math.max(1, Math.ceil(w / block));
  const smallHeight = Math.max(1, Math.ceil(h / block));
  const small = document.createElement("canvas");
  small.width = smallWidth;
  small.height = smallHeight;
  const smallCtx = small.getContext("2d");
  const scaleX = (source.naturalWidth || source.width) / width;
  const scaleY = (source.naturalHeight || source.height) / height;
  smallCtx.drawImage(
    source,
    x * scaleX,
    y * scaleY,
    w * scaleX,
    h * scaleY,
    0,
    0,
    smallWidth,
    smallHeight,
  );
  ctx.save();
  // 只畫在標記範圍內（放大後的格子可能超出一點）
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, smallWidth, smallHeight, x, y, smallWidth * block, smallHeight * block);
  ctx.restore();
  small.width = 1;
  small.height = 1;
};

const drawArrow = (ctx, item, width, height, metrics) => {
  const x1 = item.x1 * width;
  const y1 = item.y1 * height;
  const x2 = item.x2 * width;
  const y2 = item.y2 * height;
  const stroke = metrics.stroke(item.size);
  const head = stroke * 4.5;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = normalizeColor(item.color);
  ctx.lineWidth = stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.moveTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
};

/**
 * 繪製文字或編號標籤，並回傳它在畫面上的範圍（比例座標），供標記視窗判斷點選。
 */
const drawTextLike = (ctx, item, width, height, metrics) => {
  const x = item.x * width;
  const y = item.y * height;
  const text = item.text || "";
  if (item.type === "label") {
    const diameter = metrics.label(item.size);
    const fontSize = diameter * (text.length > 1 ? 0.42 : 0.55);
    ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`;
    const textWidth = ctx.measureText(text).width;
    const boxWidth = Math.max(diameter, textWidth + diameter * 0.5);
    const radius = diameter / 2;
    ctx.beginPath();
    ctx.roundRect(x - boxWidth / 2, y - radius, boxWidth, diameter, radius);
    ctx.fillStyle = normalizeColor(item.color);
    ctx.fill();
    ctx.lineWidth = Math.max(2, diameter * 0.08);
    ctx.strokeStyle = item.color === "#ffffff" ? "#1f1e1d" : "#ffffff";
    ctx.stroke();
    ctx.fillStyle = contrastingInk(item.color);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + fontSize * 0.04);
    return {
      x: (x - boxWidth / 2) / width,
      y: (y - radius) / height,
      w: boxWidth / width,
      h: diameter / height,
    };
  }
  const fontSize = metrics.font(item.size);
  ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = text.split("\n");
  const lineHeight = fontSize * 1.25;
  let maxWidth = 0;
  lines.forEach((line, index) => {
    const lineY = y + index * lineHeight;
    ctx.lineJoin = "round";
    ctx.lineWidth = fontSize * 0.2;
    ctx.strokeStyle = outlineFor(item.color);
    ctx.strokeText(line, x, lineY);
    ctx.fillStyle = normalizeColor(item.color);
    ctx.fillText(line, x, lineY);
    maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
  });
  return {
    x: x / width,
    y: y / height,
    w: Math.max(maxWidth, fontSize) / width,
    h: (lines.length * lineHeight) / height,
  };
};

/** 中心連線與矩形邊框的交點（從中心往方向 (dx, dy) 走到邊框）。 */
const edgePoint = (cx, cy, halfW, halfH, dx, dy) => {
  const tx = dx ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = dy ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return [cx + dx * t, cy + dy * t];
};

/**
 * 局部放大：放大框內容取自「照片＋遮蔽」的底圖（原始解析度），
 * 所以輸出時細節清楚，遮蔽也一樣蓋住。
 */
const drawZoom = (ctx, base, item, width, height, metrics) => {
  const color = normalizeColor(item.color);
  const stroke = metrics.stroke(item.size);
  const sx = item.sx * width;
  const sy = item.sy * height;
  const sw = item.sw * width;
  const sh = item.sh * height;
  const tx = item.x * width;
  const ty = item.y * height;
  const tw = item.w * width;
  const th = item.h * height;

  if (item.connector) {
    const scx = sx + sw / 2;
    const scy = sy + sh / 2;
    const tcx = tx + tw / 2;
    const tcy = ty + th / 2;
    const length = Math.hypot(tcx - scx, tcy - scy);
    if (length > 1) {
      const dx = (tcx - scx) / length;
      const dy = (tcy - scy) / length;
      const [x1, y1] = edgePoint(scx, scy, sw / 2, sh / 2, dx, dy);
      const [x2, y2] = edgePoint(tcx, tcy, tw / 2, th / 2, -dx, -dy);
      // 兩框重疊時不畫線
      if ((x2 - x1) * dx + (y2 - y1) * dy > 0) {
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = color;
        ctx.lineWidth = stroke;
        ctx.stroke();
      }
    }
  }

  // 來源框
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke;
  ctx.strokeRect(sx, sy, sw, sh);

  // 放大框：放大的影像＋彩色邊框
  const baseWidth = base.width;
  const baseHeight = base.height;
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    base,
    item.sx * baseWidth,
    item.sy * baseHeight,
    Math.max(1, item.sw * baseWidth),
    Math.max(1, item.sh * baseHeight),
    tx,
    ty,
    tw,
    th,
  );
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke;
  ctx.strokeRect(tx, ty, tw, th);
};

/** 局部放大用的底圖：原始解析度的照片，加上遮蔽。 */
const buildZoomBase = (source, annotations) => {
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, width, height);
  const metrics = metricsFor(width, height);
  annotations
    .filter((item) => item.type === "mask")
    .forEach((item) => drawMask(ctx, source, item, width, height, metrics));
  return canvas;
};

/**
 * 在 ctx 上畫出照片與所有標記。遮蔽先畫（只遮照片本身），其他標記疊在上面。
 * 回傳每個文字／編號標籤的範圍，以 id 為 key。
 */
export const drawAnnotatedImage = (ctx, source, annotations, width, height) => {
  ctx.drawImage(source, 0, 0, width, height);
  const metrics = metricsFor(width, height);
  const boxes = {};
  annotations
    .filter((item) => item.type === "mask")
    .forEach((item) => drawMask(ctx, source, item, width, height, metrics));
  const zoomBase = annotations.some((item) => item.type === "zoom")
    ? buildZoomBase(source, annotations)
    : null;
  annotations.forEach((item) => {
    if (item.type === "mask") return;
    ctx.save();
    if (item.type === "zoom") {
      drawZoom(ctx, zoomBase, item, width, height, metrics);
    } else if (item.type === "arrow") {
      drawArrow(ctx, item, width, height, metrics);
    } else if (item.type === "text" || item.type === "label") {
      boxes[item.id] = drawTextLike(ctx, item, width, height, metrics);
    } else {
      const x = item.x * width;
      const y = item.y * height;
      const w = item.w * width;
      const h = item.h * height;
      ctx.strokeStyle = normalizeColor(item.color);
      ctx.lineWidth = metrics.stroke(item.size);
      ctx.beginPath();
      if (item.type === "ellipse") {
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      } else {
        ctx.rect(x, y, w, h);
      }
      ctx.stroke();
    }
    ctx.restore();
  });
  if (zoomBase) {
    zoomBase.width = 1;
    zoomBase.height = 1;
  }
  return boxes;
};

/* ---------- 合成含標記的圖片 ---------- */

const loadImageElement = (blob) =>
  new Promise((resolve, reject) => {
    const url = createObjectUrl(blob);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      revokeObjectUrl(url);
      reject(new Error("無法讀取照片"));
    };
    image.src = url;
  });

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("無法產生含標記的照片"))),
      type,
      quality,
    ),
  );

/**
 * 產生含標記的照片。沒有標記時直接回傳原圖。
 * maxDimension 可限制輸出尺寸（例如照片卡片只需要小圖）。
 */
export const createAnnotatedBlob = async (image, { maxDimension = 0 } = {}) => {
  const annotations = getAnnotations(image.id);
  if (!annotations.length) return image.blob;
  const { image: source, url } = await loadImageElement(image.blob);
  try {
    const naturalWidth = source.naturalWidth || image.width;
    const naturalHeight = source.naturalHeight || image.height;
    const scale = maxDimension
      ? Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight))
      : 1;
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    drawAnnotatedImage(canvas.getContext("2d"), source, annotations, width, height);
    const isPng = image.blob.type === "image/png";
    const blob = await canvasToBlob(canvas, isPng ? "image/png" : "image/jpeg", 0.92);
    canvas.width = 1;
    canvas.height = 1;
    return blob;
  } finally {
    revokeObjectUrl(url);
  }
};

/**
 * 照片卡片顯示用：有標記時產生含標記的小圖，回傳網址；沒有標記時回傳原圖網址。
 * 舊的小圖網址會一併釋放。
 */
export const refreshAnnotatedPreview = async (image) => {
  if (image.annotatedPreviewUrl) {
    revokeObjectUrl(image.annotatedPreviewUrl);
    image.annotatedPreviewUrl = "";
  }
  if (!hasAnnotations(image.id)) return image.previewUrl;
  const blob = await createAnnotatedBlob(image, { maxDimension: DISPLAY_MAX_DIMENSION });
  image.annotatedPreviewUrl = createObjectUrl(blob);
  return image.annotatedPreviewUrl;
};

export const releaseAnnotatedPreview = (image) => {
  if (image?.annotatedPreviewUrl) {
    revokeObjectUrl(image.annotatedPreviewUrl);
    image.annotatedPreviewUrl = "";
  }
};

/**
 * 照片旋轉 90° 的倍數時，同步轉換標記位置。文字與編號只移動位置、保持正向。
 * degrees：90 為順時針，-90 為逆時針。
 */
export const rotateAnnotations = (annotations, degrees) => {
  const turns = (((Math.round(degrees / 90) % 4) + 4) % 4);
  const rotatePoint = (x, y) => {
    let px = x;
    let py = y;
    for (let i = 0; i < turns; i += 1) [px, py] = [1 - py, px];
    return [px, py];
  };
  return annotations.map((item) => {
    if (item.type === "arrow") {
      const [x1, y1] = rotatePoint(item.x1, item.y1);
      const [x2, y2] = rotatePoint(item.x2, item.y2);
      return { ...item, x1, y1, x2, y2 };
    }
    if (item.type === "text" || item.type === "label") {
      const [x, y] = rotatePoint(item.x, item.y);
      return { ...item, x, y };
    }
    if (item.type === "zoom") {
      const [sax, say] = rotatePoint(item.sx, item.sy);
      const [sbx, sby] = rotatePoint(item.sx + item.sw, item.sy + item.sh);
      const [tax, tay] = rotatePoint(item.x, item.y);
      const [tbx, tby] = rotatePoint(item.x + item.w, item.y + item.h);
      return {
        ...item,
        sx: Math.min(sax, sbx),
        sy: Math.min(say, sby),
        sw: Math.abs(sbx - sax),
        sh: Math.abs(sby - say),
        x: Math.min(tax, tbx),
        y: Math.min(tay, tby),
        w: Math.abs(tbx - tax),
        h: Math.abs(tby - tay),
      };
    }
    const [ax, ay] = rotatePoint(item.x, item.y);
    const [bx, by] = rotatePoint(item.x + item.w, item.y + item.h);
    return {
      ...item,
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay),
    };
  });
};

export const createAnnotationId = () =>
  `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
