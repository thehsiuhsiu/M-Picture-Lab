// imageHandler.js - 圖片處理模組

import { state, ACCIDENT_TAG_OPTIONS } from "./state.js";
import {
  createThumbnail,
  formatExifDate,
  showUploadingModal,
  hideUploadingModal,
  showConversionModal,
  hideConversionModal,
  EMPTY_STATE_HTML,
} from "./utils.js";

/**
 * 處理圖片選擇事件
 */
export const handleImageSelection = (event) => {
  const files = Array.from(event.target.files);
  showUploadingModal();
  processFiles(files);
  event.target.value = "";
};

/**
 * 處理檔案陣列
 */
const processFiles = (files) => {
  console.log("Processing files:", files.length);
  const promises = files.map(
    (file) =>
      new Promise((resolve, reject) => {
        const isHEIC =
          file.type === "image/heic" ||
          file.type === "image/heif" ||
          file.name.toLowerCase().endsWith(".heic") ||
          file.name.toLowerCase().endsWith(".heif");

        // 處理圖片並解析 EXIF (可傳入預先讀取的 EXIF 日期)
        const processImage = (blob, fileName, preExtractedDate = null) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target.result;
            const img = new Image();
            img.onload = () => {
              // 如果有預先提取的日期（來自 HEIC），直接使用
              if (preExtractedDate !== null) {
                createThumbnail(dataUrl)
                  .then((thumbnailUrl) => {
                    resolve({
                      id: Date.now() + Math.random(),
                      data: dataUrl,
                      thumbnail: thumbnailUrl,
                      name: fileName,
                      size: blob.size,
                      width: img.width,
                      height: img.height,
                      date: preExtractedDate,
                    });
                  })
                  .catch(reject);
              } else {
                // 一般圖片：從轉換後的圖片讀取 EXIF
                EXIF.getData(img, function () {
                  const exifDate = EXIF.getTag(this, "DateTimeOriginal");
                  const formattedDate = formatExifDate(exifDate);
                  createThumbnail(dataUrl)
                    .then((thumbnailUrl) => {
                      resolve({
                        id: Date.now() + Math.random(),
                        data: dataUrl,
                        thumbnail: thumbnailUrl,
                        name: fileName,
                        size: blob.size,
                        width: img.width,
                        height: img.height,
                        date: formattedDate,
                      });
                    })
                    .catch(reject);
                });
              }
            };
            img.onerror = reject;
            img.src = dataUrl;
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        };

        if (isHEIC) {
          showConversionModal();

          // 使用 exifr 從原始 HEIC 檔案讀取 EXIF 日期
          exifr
            .parse(file, {
              pick: ["DateTimeOriginal", "CreateDate", "ModifyDate"],
            })
            .then((exifData) => {
              let heicExifDate = null;
              if (exifData) {
                // 優先使用 DateTimeOriginal，其次 CreateDate
                const dateValue =
                  exifData.DateTimeOriginal ||
                  exifData.CreateDate ||
                  exifData.ModifyDate;
                if (dateValue) {
                  // exifr 回傳的是 Date 物件，轉換成我們需要的格式
                  heicExifDate = formatExifDate(dateValue);
                  console.log("HEIC EXIF 日期讀取成功:", heicExifDate);
                }
              }

              // 轉換 HEIC 為 JPEG
              return heic2any({
                blob: file,
                toType: "image/jpeg",
                quality: 0.8,
              }).then((convertedBlob) => {
                hideConversionModal();
                // 傳入預先讀取的 EXIF 日期
                processImage(
                  convertedBlob,
                  file.name.replace(/\.(heic|heif)$/i, ".jpg"),
                  heicExifDate
                );
              });
            })
            .catch((error) => {
              hideConversionModal();
              console.error("HEIC conversion failed:", error);
              alert(
                `HEIC 檔案 "${file.name}" 轉換失敗，請嘗試其他格式的圖片。`
              );
              reject(error);
            });
        } else {
          processImage(file, file.name);
        }
      })
  );

  Promise.all(promises)
    .then((imageDataArray) => {
      console.log("Image data processed:", imageDataArray.length);
      imageDataArray.forEach(handleImageAddition);
      hideUploadingModal();
    })
    .catch((error) => {
      hideConversionModal();
      hideUploadingModal();
      console.error("Error processing images:", error);
      alert("處理圖片時發生錯誤，請重試。");
    });
};

/**
 * 處理圖片新增
 */
const handleImageAddition = (imageData) => {
  const emptyState = document.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }
  if (isDuplicateImage(imageData)) {
    console.log("Duplicate found:", imageData.name);
    if (confirm(`檔案 "${imageData.name}" 已經存在。是否重複新增？`)) {
      addImageToCollection(imageData);
    } else {
      console.log("User chose not to add duplicate image");
    }
  } else {
    addImageToCollection(imageData);
  }
};

/**
 * 檢查是否為重複圖片
 */
const isDuplicateImage = (newImage) => {
  return state.selectedImages.some(
    (img) =>
      img.name === newImage.name &&
      img.size === newImage.size &&
      img.width === newImage.width &&
      img.height === newImage.height
  );
};

/**
 * 將圖片加入收藏
 */
const addImageToCollection = (imageData) => {
  state.selectedImages.push(imageData);
  addImageToPreview(imageData, state.selectedImages.length);
  updateCreateButtonState();
  console.log("Image added to collection:", imageData.name);
  console.log("Total images in collection:", state.selectedImages.length);
};

/**
 * 將圖片加入預覽區
 */
const addImageToPreview = (imageData, counter) => {
  const preview = document.getElementById("imagePreview");
  const imageContainer = document.createElement("div");
  imageContainer.className = "image-container";
  imageContainer.dataset.id = imageData.id;
  imageContainer.draggable = true;

  const counterElement = document.createElement("div");
  counterElement.className = "image-counter";
  counterElement.textContent = counter;
  imageContainer.appendChild(counterElement);

  const img = document.createElement("img");
  img.src = imageData.thumbnail;
  img.alt = imageData.name;
  img.title = imageData.name; // 滑鼠懸停時顯示檔名
  imageContainer.appendChild(img);

  // 讓新照片套用目前滑桿大小
  const slider = document.getElementById("photoSizeSlider");
  if (slider) {
    img.style.maxWidth = slider.value + "px";
    img.style.maxHeight = slider.value + "px";
  }

  // 新增說明文字區
  const descriptionDiv = document.createElement("div");
  descriptionDiv.className = "image-description";

  // 日期輸入欄位
  const dateInput = document.createElement("input");
  dateInput.type = "text";
  dateInput.className = "image-date-input";
  dateInput.placeholder = "日期 (留空則使用側邊欄資訊)";
  dateInput.value = state.imageDates[imageData.id] || "";
  dateInput.addEventListener("input", (e) => {
    state.imageDates[imageData.id] = e.target.value;
  });
  dateInput.addEventListener("dragover", (e) => e.preventDefault());
  dateInput.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  descriptionDiv.appendChild(dateInput);

  // 地址輸入欄位
  const addressInput = document.createElement("input");
  addressInput.type = "text";
  addressInput.className = "image-address-input";
  addressInput.placeholder = "地址 (留空則使用側邊欄資訊)";
  addressInput.value = state.imageAddresses[imageData.id] || "";
  addressInput.addEventListener("input", (e) => {
    state.imageAddresses[imageData.id] = e.target.value;
  });
  addressInput.addEventListener("dragover", (e) => e.preventDefault());
  addressInput.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  descriptionDiv.appendChild(addressInput);

  // 說明輸入欄位 (僅限刑事案件)
  const textarea = document.createElement("textarea");
  textarea.className = "image-description-textarea";
  textarea.placeholder = "說明 (選填)";
  textarea.value = state.imageDescriptions[imageData.id] || "";
  textarea.addEventListener("input", (e) => {
    state.imageDescriptions[imageData.id] = e.target.value;
  });
  textarea.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  textarea.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  descriptionDiv.appendChild(textarea);

  // 交通事故勾選框 UI
  const accidentTagsContainer = document.createElement("div");
  accidentTagsContainer.className = "accident-tags-container";
  accidentTagsContainer.dataset.format = "middle";

  // 初始化勾選狀態
  if (!state.imageAccidentTags[imageData.id]) {
    state.imageAccidentTags[imageData.id] = {};
  }

  ACCIDENT_TAG_OPTIONS.forEach((option) => {
    const tagLabel = document.createElement("label");
    tagLabel.className = "accident-tag-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "accident-tag-checkbox";
    checkbox.checked =
      state.imageAccidentTags[imageData.id][option.id] || false;

    tagLabel.appendChild(checkbox);

    const labelText = document.createElement("span");
    labelText.textContent = option.label;
    tagLabel.appendChild(labelText);

    // 如果是"其他"選項，添加文字輸入框
    if (option.id === "other") {
      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.className = "accident-tag-other-input";
      otherInput.placeholder = "________________";
      otherInput.value = state.imageAccidentTags[imageData.id].otherText || "";
      // 根據勾選狀態設定是否可輸入
      otherInput.disabled = !checkbox.checked;
      otherInput.addEventListener("input", (e) => {
        state.imageAccidentTags[imageData.id].otherText = e.target.value;
      });
      otherInput.addEventListener("dragover", (e) => e.preventDefault());
      otherInput.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      tagLabel.appendChild(otherInput);

      // 勾選時啟用輸入框，取消勾選時禁用
      checkbox.addEventListener("change", (e) => {
        state.imageAccidentTags[imageData.id][option.id] = e.target.checked;
        otherInput.disabled = !e.target.checked;
        if (e.target.checked) {
          otherInput.focus();
        }
      });
    } else {
      checkbox.addEventListener("change", (e) => {
        state.imageAccidentTags[imageData.id][option.id] = e.target.checked;
      });
    }

    accidentTagsContainer.appendChild(tagLabel);
  });

  descriptionDiv.appendChild(accidentTagsContainer);
  imageContainer.appendChild(descriptionDiv);

  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-button";
  deleteButton.textContent = "×";
  deleteButton.onclick = () => removeImage(imageData.id);
  imageContainer.appendChild(deleteButton);

  preview.appendChild(imageContainer);
  console.log("Image preview added:", imageData.name);
};

/**
 * 處理檢視模式切換
 */
export const handleViewModeChange = (mode) => {
  state.viewMode = mode;
  const preview = document.getElementById("imagePreview");
  const gridViewBtn = document.getElementById("gridViewBtn");
  const listViewBtn = document.getElementById("listViewBtn");

  if (mode === "list") {
    preview.classList.add("list-view");
    gridViewBtn.classList.remove("active");
    listViewBtn.classList.add("active");
  } else {
    preview.classList.remove("list-view");
    gridViewBtn.classList.add("active");
    listViewBtn.classList.remove("active");
    // 切換回 grid 時重新套用滑桿大小
    const slider = document.getElementById("photoSizeSlider");
    if (slider) {
      const imgs = preview.querySelectorAll(".image-container img");
      imgs.forEach((img) => {
        img.style.maxWidth = slider.value + "px";
        img.style.maxHeight = slider.value + "px";
      });
    }
  }
  console.log("View mode changed to:", state.viewMode);
};

/**
 * 處理圖片容器拖曳事件
 */
export const handleImageContainerEvents = (e) => {
  // 忽略來自 textarea 的拖曳事件
  if (e.target.tagName === "TEXTAREA") return;

  const container = e.target.closest(".image-container");
  if (!container) return;

  // 如果圖片處於編輯模式，不允許拖曳
  if (container.classList.contains("editing")) {
    e.preventDefault();
    return;
  }

  if (!e.dataTransfer) return;

  switch (e.type) {
    case "dragstart":
      // 如果任何圖片正在編輯中，阻止拖曳
      if (state.editingImageId) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("text/plain", container.dataset.id);
      container.style.opacity = "0.5";
      break;
    case "dragover":
    case "dragenter":
      e.preventDefault();
      container.classList.add("drag-over");
      break;
    case "dragleave":
    case "drop":
      container.classList.remove("drag-over");
      if (e.type === "drop") {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData("text");
        handleImageDrop(draggedId, container);
      }
      break;
    case "dragend":
      container.style.opacity = "";
      break;
  }
};

/**
 * 處理圖片拖放
 */
const handleImageDrop = (draggedId, dropZone) => {
  const draggedElement = document.querySelector(
    `.image-container[data-id="${draggedId}"]`
  );
  if (draggedElement && dropZone && draggedElement !== dropZone) {
    const preview = document.getElementById("imagePreview");
    const allContainers = Array.from(
      preview.querySelectorAll(".image-container")
    );
    const draggedIndex = allContainers.indexOf(draggedElement);
    const dropIndex = allContainers.indexOf(dropZone);

    const [movedImage] = state.selectedImages.splice(draggedIndex, 1);
    state.selectedImages.splice(dropIndex, 0, movedImage);

    if (draggedIndex < dropIndex) {
      dropZone.parentNode.insertBefore(draggedElement, dropZone.nextSibling);
    } else {
      dropZone.parentNode.insertBefore(draggedElement, dropZone);
    }

    updateImageOrder();
  }
};

/**
 * 更新圖片順序
 */
const updateImageOrder = () => {
  const preview = document.getElementById("imagePreview");
  const containers = Array.from(preview.querySelectorAll(".image-container"));

  containers.forEach((container, index) => {
    const counter = container.querySelector(".image-counter");
    if (counter) {
      counter.textContent = index + 1;
    }
  });

  state.imageCounter = containers.length;

  console.log(
    "Image order updated. New order:",
    state.selectedImages.map((img) => img.name)
  );
  console.log("Total images after reorder:", state.selectedImages.length);

  updateCreateButtonState();
};

/**
 * 更新編輯工具按鈕狀態
 */
const updateEditToolsState = (enabled) => {
  const rotateLeftBtn = document.getElementById("rotateLeftBtn");
  const rotateRightBtn = document.getElementById("rotateRightBtn");
  const cancelEditBtn = document.getElementById("cancelEditBtn");
  const editHint = document.getElementById("editHint");

  if (rotateLeftBtn) rotateLeftBtn.disabled = !enabled;
  if (rotateRightBtn) rotateRightBtn.disabled = !enabled;
  if (cancelEditBtn) cancelEditBtn.disabled = !enabled;

  if (editHint) {
    editHint.textContent = enabled
      ? "照片編輯中，無法拖曳排序"
      : "點擊照片以進入編輯模式";
    editHint.classList.toggle("editing-active", enabled);
  }
};

/**
 * 移除圖片
 */
export const removeImage = (id) => {
  console.log("Removing image with id:", id);

  // 如果正在編輯的圖片被刪除，取消編輯模式
  if (state.editingImageId === id) {
    state.editingImageId = null;
    updateEditToolsState(false);
  }

  state.selectedImages = state.selectedImages.filter((img) => img.id !== id);
  delete state.imageDescriptions[id];
  delete state.imageDates[id];
  delete state.imageAddresses[id];
  delete state.imageAccidentTags[id];
  delete state.imageRotations[id];

  const imageElement = document.querySelector(
    `.image-container[data-id="${id}"]`
  );
  if (imageElement) {
    imageElement.remove();
  }

  updateImageCounters();
  updateCreateButtonState();
  console.log("Image removed. Remaining images:", state.selectedImages.length);

  // 檢查是否沒有圖片，顯示空狀態
  if (state.selectedImages.length === 0) {
    showEmptyState();
  }
};

/**
 * 顯示空狀態提示
 */
const showEmptyState = () => {
  const imagePreview = document.getElementById("imagePreview");
  const emptyStateDiv = document.createElement("div");
  emptyStateDiv.className = "empty-state";
  emptyStateDiv.innerHTML = EMPTY_STATE_HTML;
  imagePreview.appendChild(emptyStateDiv);
  console.log("No images left, displaying empty state.");
};

/**
 * 更新圖片計數器
 */
const updateImageCounters = () => {
  const containers = document.querySelectorAll(".image-container");
  containers.forEach((container, index) => {
    const counter = container.querySelector(".image-counter");
    if (counter) {
      counter.textContent = index + 1;
    }
  });
  state.imageCounter = containers.length;
  console.log("Image counters updated. New count:", state.imageCounter);
};

/**
 * 更新建立按鈕狀態
 */
export const updateCreateButtonState = () => {
  const createButton = document.getElementById("generate");
  if (!createButton) {
    console.error("Create button not found");
    return;
  }
  const isEnabled = state.selectedImages.length > 0;

  createButton.classList.toggle("create-btn-disabled", !isEnabled);
  createButton.classList.toggle("create-btn-enabled", isEnabled);

  console.log("Create button state updated. Enabled:", isEnabled);
  console.log("Selected images count:", state.selectedImages.length);
};

/**
 * 設定編輯中的圖片
 */
export const setEditingImage = (imageId) => {
  // 移除之前編輯中的狀態
  const previousEditing = document.querySelector(".image-container.editing");
  if (previousEditing) {
    previousEditing.classList.remove("editing");
    previousEditing.draggable = true;
  }

  // 設定新的編輯狀態
  if (imageId) {
    state.editingImageId = imageId;
    const container = document.querySelector(
      `.image-container[data-id="${imageId}"]`
    );
    if (container) {
      container.classList.add("editing");
      container.draggable = false;
    }
    updateEditToolsState(true);
  } else {
    state.editingImageId = null;
    updateEditToolsState(false);
  }
};

/**
 * 取消編輯模式
 */
export const cancelEditing = () => {
  setEditingImage(null);
};

/**
 * 旋轉圖片
 * @param {number} degrees - 旋轉角度 (90 或 -90)
 */
export const rotateImage = async (degrees) => {
  if (!state.editingImageId) return;

  const imageData = state.selectedImages.find(
    (img) => img.id === state.editingImageId
  );
  if (!imageData) return;

  // 取得目前旋轉角度
  const currentRotation = state.imageRotations[state.editingImageId] || 0;
  const newRotation = (currentRotation + degrees + 360) % 360;
  state.imageRotations[state.editingImageId] = newRotation;

  // 建立旋轉後的圖片
  const rotatedData = await rotateImageData(imageData.data, degrees);

  // 更新圖片資料
  imageData.data = rotatedData.data;
  imageData.thumbnail = rotatedData.thumbnail;

  // 交換寬高（90度旋轉後寬高互換）
  const tempWidth = imageData.width;
  imageData.width = imageData.height;
  imageData.height = tempWidth;

  // 更新 DOM
  const container = document.querySelector(
    `.image-container[data-id="${state.editingImageId}"]`
  );
  if (container) {
    const img = container.querySelector("img");
    if (img) {
      img.src = rotatedData.thumbnail;
    }
  }

  console.log(
    `Image rotated by ${degrees} degrees. New rotation: ${newRotation}`
  );
};

/**
 * 旋轉圖片資料
 * @param {string} dataUrl - 圖片的 data URL
 * @param {number} degrees - 旋轉角度
 * @returns {Promise<{data: string, thumbnail: string}>} - 旋轉後的圖片資料
 */
const rotateImageData = (dataUrl, degrees) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // 建立 canvas 進行旋轉
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      // 90度或270度時需要交換寬高
      if (Math.abs(degrees) === 90 || Math.abs(degrees) === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      // 移動到中心點進行旋轉
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      // 取得旋轉後的資料
      const rotatedDataUrl = canvas.toDataURL("image/jpeg", 0.9);

      // 建立縮圖
      const thumbCanvas = document.createElement("canvas");
      const thumbCtx = thumbCanvas.getContext("2d");
      const maxThumbSize = 400;
      const scale = Math.min(
        maxThumbSize / canvas.width,
        maxThumbSize / canvas.height,
        1
      );
      thumbCanvas.width = canvas.width * scale;
      thumbCanvas.height = canvas.height * scale;
      thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const thumbnailUrl = thumbCanvas.toDataURL("image/jpeg", 0.8);

      resolve({
        data: rotatedDataUrl,
        thumbnail: thumbnailUrl,
      });
    };
    img.src = dataUrl;
  });
};

/**
 * 處理圖片點擊事件（進入編輯模式）
 */
export const handleImageClick = (e) => {
  // 忽略來自按鈕、輸入框的點擊
  if (
    e.target.tagName === "BUTTON" ||
    e.target.tagName === "INPUT" ||
    e.target.tagName === "TEXTAREA" ||
    e.target.closest(".delete-button") ||
    e.target.closest(".accident-tag-label")
  ) {
    return;
  }

  const container = e.target.closest(".image-container");
  if (!container) return;

  const imageId = parseFloat(container.dataset.id);

  // 如果點擊的是已經在編輯的圖片，則取消編輯
  if (state.editingImageId === imageId) {
    cancelEditing();
  } else {
    setEditingImage(imageId);
  }
};
