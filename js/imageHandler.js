// imageHandler.js - 圖片處理模組

import { state } from "./state.js";
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

        const processImage = (blob, fileName) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target.result;
            const img = new Image();
            img.onload = () => {
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
            };
            img.onerror = reject;
            img.src = dataUrl;
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        };

        if (isHEIC) {
          showConversionModal();
          heic2any({
            blob: file,
            toType: "image/jpeg",
            quality: 0.8,
          })
            .then((convertedBlob) => {
              hideConversionModal();
              processImage(
                convertedBlob,
                file.name.replace(/\.(heic|heif)$/i, ".jpg")
              );
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
  updateDownloadZipButtonState();
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

  // 說明輸入欄位
  const textarea = document.createElement("textarea");
  textarea.placeholder = "說明 (選填，僅限刑事案件格式)";
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

  if (!e.dataTransfer) return;

  switch (e.type) {
    case "dragstart":
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
  updateDownloadZipButtonState();
};

/**
 * 移除圖片
 */
export const removeImage = (id) => {
  console.log("Removing image with id:", id);
  state.selectedImages = state.selectedImages.filter((img) => img.id !== id);
  delete state.imageDescriptions[id];

  const imageElement = document.querySelector(
    `.image-container[data-id="${id}"]`
  );
  if (imageElement) {
    imageElement.remove();
  }

  updateImageCounters();
  updateCreateButtonState();
  updateDownloadZipButtonState();
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
 * 更新下載 ZIP 按鈕狀態
 */
export const updateDownloadZipButtonState = () => {
  const btn = document.getElementById("downloadZip");
  if (state.selectedImages.length > 0) {
    btn.classList.remove("downzip-btn-disabled");
    btn.classList.add("downzip-btn-enabled");
  } else {
    btn.classList.add("downzip-btn-disabled");
    btn.classList.remove("downzip-btn-enabled");
  }
};
