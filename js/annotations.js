// annotations.js - 照片標記：資料格式、檢查、繪製與合成
//
// 標記與原圖分開保存（見 docs/adr/0002-non-destructive-annotations.md）。
// 座標一律存成「相對於照片寬高的比例」（0～1），照片縮放或旋轉時不必換算像素。

import { state } from "./state.js?v=20261023-1";
import { createObjectUrl, revokeObjectUrl } from "./utils.js?v=20261023-1";

export const ANNOTATION_TYPES = Object.freeze([
  "ellipse",
  "rect",
  "arrow",
  "text",
  "label",
  "mask",
]);
export const ANNOTATION_COLORS = Object.freeze({
  red: "#e03b2e",
  yellow: "#f5c518",
  white: "#ffffff",
  black: "#1f1e1d",
});
export const ANNOTATION_SIZES = Object.freeze(["thin", "medium", "thick"]);
export const MASK_STYLES = Object.freeze(["mosaic", "black"]);
export const MAX_ANNOTATIONS_PER_IMAGE = 200;
export const MAX_TEXT_LENGTH = 100;
export const MAX_LABEL_LENGTH = 3;

const STROKE_RATIO = { thin: 0.004, medium: 0.007, thick: 0.011 };
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
      color: pickEnum(item.color, Object.keys(ANNOTATION_COLORS), "red"),
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
    stroke: (size) => Math.max(2, base * STROKE_RATIO[size]),
    font: (size) => Math.max(12, base * FONT_RATIO[size]),
    label: (size) => Math.max(18, base * LABEL_RATIO[size]),
  };
};

const contrastingInk = (colorKey) =>
  colorKey === "white" || colorKey === "yellow" ? "#1f1e1d" : "#ffffff";

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
  ctx.strokeStyle = ANNOTATION_COLORS[item.color];
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
    ctx.fillStyle = ANNOTATION_COLORS[item.color];
    ctx.fill();
    ctx.lineWidth = Math.max(2, diameter * 0.08);
    ctx.strokeStyle = item.color === "white" ? "#1f1e1d" : "#ffffff";
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
    ctx.strokeStyle = item.color === "white" ? "#1f1e1d" : "#ffffff";
    ctx.strokeText(line, x, lineY);
    ctx.fillStyle = ANNOTATION_COLORS[item.color];
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
  annotations.forEach((item) => {
    if (item.type === "mask") return;
    ctx.save();
    if (item.type === "arrow") {
      drawArrow(ctx, item, width, height, metrics);
    } else if (item.type === "text" || item.type === "label") {
      boxes[item.id] = drawTextLike(ctx, item, width, height, metrics);
    } else {
      const x = item.x * width;
      const y = item.y * height;
      const w = item.w * width;
      const h = item.h * height;
      ctx.strokeStyle = ANNOTATION_COLORS[item.color];
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
