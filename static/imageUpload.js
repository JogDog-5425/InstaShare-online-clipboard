import {spaceId, currentImageUrl} from "./clipboardShare.js";

// ============ Global variables ============
let currentImageExtension = null;

// Cached elements
const imageUI = {
    fileInput: document.getElementById("fileInput"),
    dropZone: document.getElementById("dropZone"),
    preview: document.getElementById("imagePreview"),
    btnCopy: document.getElementById("btnCopy"),
    btnDownload: document.getElementById("btnDownload"),
    labelUploadStatus: document.getElementById("imageStatus")
}


// ============ Bind events (basic events pre-assigned in HTML) ============
// Click and upload
imageUI.dropZone.addEventListener("click", () => imageUI.fileInput.click());
imageUI.fileInput.addEventListener("change", () => {
  if (imageUI.fileInput.files.length > 0) uploadImage(imageUI.fileInput.files[0], spaceId);
});

// Drag-and-drop upload
imageUI.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    imageUI.dropZone.classList.add("dragover");
});
imageUI.dropZone.addEventListener("dragleave", () => {
    imageUI.dropZone.classList.remove("dragover");
});
imageUI.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    imageUI.dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) uploadImage(file, spaceId);
});

// Read image from paste event
document.addEventListener("paste", (e) => {
  const items = e.clipboardData.items;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) uploadImage(file, spaceId);
      return;
    }
  }
});


// ============ Implementations ============
async function uploadImage(file, destSpaceId) {
    if (!destSpaceId) return;
    currentImageExtension = file.name?.split('.').pop() || 'png';

    // Pack image into form
    const form = new FormData();
    form.append("file", file, file.name);

    try {
        updateUploadStatus("Uploading", "primary");
        // Send a post request to upload the file
        const res = await fetch(`/api/spaces/${destSpaceId}/image`, {
            method: "POST",
            body: form,
        });
        const data = await res.json();
        if (!data.status) {
            updateUploadStatus(data.message || "Upload failed", "danger");
            return;
        }

        updateUploadStatus("Uploaded", "success");
    } catch (err) {
        console.error(err);
        updateUploadStatus("Upload error", "danger");
    }
}

// When download is clicked
function downloadImage() {
    if (!currentImageUrl) return;
    const a = document.createElement("a");
    a.href = currentImageUrl;
    const extension = currentImageExtension || currentImageUrl.split(".").pop().split(/[?#]/)[0] || "png";
    a.download = `clipboard_${Date.now()}.${extension}`;
    a.click();
}

// When copy is clicked
async function addToSystemClipboard() {
    if (!currentImageUrl) return;
    try {
        const res = await fetch(currentImageUrl);
        const blob = await res.blob();

        if (blob.type !== "image/png") {
            alert("Only PNG images can be directly copied");
            return;
        }

        // Add to system clipboard
        await navigator.clipboard.write([
            new ClipboardItem({"image/png": blob})
        ]);

        updateUploadStatus("Copied", "info")
    } catch (err) {

        console.error(err);
        alert("Image cannot be copied directly");
    }
}


// ============ Status message update ============
const ALERT_TYPES = ["success", "info", "warning", "danger", "primary", "secondary", "light", "dark"];
function updateUploadStatus(text, type = "secondary") {
    if (!ALERT_TYPES.includes(type)) type = "secondary";
    imageUI.labelUploadStatus.textContent = text;
    imageUI.labelUploadStatus.className = `badge bg-${type} mt-3 mb-4 py-2`;
}

window.addToSystemClipboard = addToSystemClipboard;
window.downloadImage = downloadImage;
