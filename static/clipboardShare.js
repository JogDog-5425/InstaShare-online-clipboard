// ============ Global variables ============
export let spaceId;
let contentSaved = false;
let readyForEdit = false;
export let currentImageUrl = null;

// Cached elements
const page = {
    alertSpaceStatus: document.getElementById("spaceStatus"),
    labelShareSpaceId: document.getElementById("labelShareSpaceId"),
    labelLastTimeUpdated: document.getElementById("timeLastUpdate"),
    labelSaved: document.getElementById("labelSaved"),
    labelConnectionStatus: document.getElementById("connectionStatus"),
    textDisplayEdit: document.getElementById("textDisplayEdit"),
    preview: document.getElementById("imagePreview"),
    btnCopy: document.getElementById("btnCopy"),
    btnDownload: document.getElementById("btnDownload"),
}


// // Flush the page when necessary (obsolete)
// setInterval(async () => {await flush()}, 2);


// ============ WebSocket ============
// Data structure: type, spaceId, data
// Types:
// create (client send), enter (client send), sync (client send), edit {data: text} (client send),
// update {data: SpaceData} (server send), response {data: OperationHint} (server send)
let websocket = null;
let wsConnected = false;
let manualClose = false;

function connectWebSocket() {
    console.log("Trying to get connected");
    manualClose = false;

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/api/spaces/ws`);
    websocket = socket;

    socket.onopen = () => {
        if (websocket !== socket) return;
        wsConnected = true;
        reconnectAttempts = 0;
        // if (!page.labelShareSpaceId.value) spaceId = page.labelShareSpaceId.value;
        updateStatus(spaceId ? `Connected to space ${spaceId}`: "You haven't joined any share space yet",
            spaceId ? "success": "secondary");
        page.labelConnectionStatus.textContent = "Connected";
        console.log("WebSocket opened");

        // Rejoin the last space after a connection loss.
        if (spaceId) {
            readyForEdit = false;
            socket.send(JSON.stringify({type: "enter", "space_id": spaceId}));
            socket.send(JSON.stringify({type: "sync", "space_id": spaceId}));
        }
    };

    socket.onmessage = (eventData) => {
        onMessageReceived(eventData);
    };

    socket.onclose = () => {
        if (websocket !== socket) return;
        wsConnected = false;
        websocket = null;
        updateStatus("You are now offline", "warning");
        page.labelConnectionStatus.textContent = "Disconnected";

        if (manualClose) return;  // Do not reconnect when connection is normal
        tryReconnect();
    };

    socket.onerror = () => {
        // onclose owns the reconnect path; closing this socket is enough.
        socket.close();
    };
}

function disconnectWebSocket() {
    manualClose = true;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (websocket) {
        websocket.close(1000, "Client close");
        websocket = null;
    }

    wsConnected = false;
    updateStatus("You are not connected", "danger");
}

async function onMessageReceived(eventData) {
    console.log("Received websocket message");
    const message = JSON.parse(eventData.data);

    if (message.type === "update") {
        console.log("Should update");
        await loadContent(message.data);
    } else if (message.type === "ping") {
        return;
    } else if (message.type === "response") {
        console.log(`Status ${message.data.success} ${message.data.message}`);
    }
}


// ============ Reconnect ============
let reconnectTimer;  // Reference to the timer instance
let reconnectAttempts = 0;
function tryReconnect() {
    if (reconnectTimer) return;  // Avoid recreating a timer instance
    // Reconnection will not happen on space switch or page close
    reconnectAttempts++;

    // The more time it retries, the longer the interval between attempts will be
    const delayDuration = Math.min(1000 * 2 ** reconnectAttempts, 10000);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
    }, delayDuration)
}

function unsubscribeWebSocketEvents() {
    if (!websocket) return;
    websocket.onopen = websocket.onmessage = websocket.onclose = websocket.onerror = null;
}

connectWebSocket();
window.addEventListener("pagehide", disconnectWebSocket);
window.addEventListener("pageshow", (event) => {
    if (event.persisted && !wsConnected) {
        connectWebSocket();
    }
});


// ============ Actions ============
window.enterSpace = enterSpace;
window.save = save;
window.startEditing = startEditing;
async function enterSpace() {
    if (!wsConnected || !websocket) {
        updateStatus("WebSocket is not connected yet", "warning");
        return;
    }
    readyForEdit = false;
    const id = document.getElementById("inputShareSpaceId").value;

    if (!id) return;

    const res = await fetch("/api/spaces/verify/" + encodeURIComponent(id));

    if (!res.ok) {
        updateStatus("Unable to verify that space", "danger");
        return;
    }

    if (await res.json()) {
        // Connect and load
        spaceId = id;
        updateStatus("Getting you connected to Space " + id, "info");
        websocket.send(JSON.stringify({type: "enter", "space_id": spaceId}));

        // Send request only
        console.log("Now sending sync request");
        websocket.send(JSON.stringify({"type": "sync", "space_id": spaceId}));
        // await loadContent();
    } else {
        // Confirm space creation
        const doCreate = confirm("There is no existing Space " + id + ". Would you like to create a new one?")
        // console.log("Has user confirmed?");
        if (doCreate) {
            spaceId = id;
            create();
            console.log("Now sending sync request");
            websocket.send(JSON.stringify({"type": "sync", "space_id": spaceId}));
        } else {
            return;
        }
    }
    updateStatus("Connected to Space " + id, "success");
    page.labelShareSpaceId.innerHTML = spaceId;
    // disconnectEES()
    // connectSSE(spaceId)

    updateSaveStatus(true)
    // shouldFlush = true;
}

function create() {
    // Send the post request
    // const res = await fetch("/api/spaces/create/" + spaceId, {
    //     method: "POST",
    //     headers: {"Content-Type": "application/json"},
    //     body: JSON.stringify({})
    // })
    // const creationResult = await res.json()
    // console.log(creationResult)
    // updateStatus("Getting you connected to Space " + spaceId, "info");
    // if (creationResult.success) {
    //     // todo creation success message + show content
    //     alert("Space " + spaceId + " has been created. ")
    //     updateStatus("Getting you connected to Space " + spaceId, "info");
    //
    //     // const spaceData = await (await fetch("/api/spaces/" + spaceId)).json()
    //     // await loadContent(spaceData)
    // } else {
    //     alert("Cannot create space.")
    // }
    // Send request only
    if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
    websocket.send(JSON.stringify({"type": "create", "space_id": spaceId}));
    console.log("Space created");
    // updateSaveStatus(true)
}

async function loadContent(spaceData) {
    // if (spaceData == null) {
    //     const res = await fetch("/api/spaces/" + spaceId);
    //     // if (res.status === 404) return handleSpaceLost();
    //     spaceData = await res.json();
    // }
    if (!spaceData) return;
    console.log("Should load content from " + JSON.stringify(spaceData));

    spaceId = spaceData.space_id;
    // console.log("New space id: " + spaceId);
    page.labelShareSpaceId.innerHTML = spaceId;
    page.labelLastTimeUpdated.innerHTML = spaceData.last_updated;
    page.textDisplayEdit.value = spaceData.content;

    showImage(spaceData.image || null);

    readyForEdit = true;
}

function showImage(url) {
    if (!url) {
        currentImageUrl = null;
        page.preview.innerHTML = `<span class="text-muted">Image preview</span>`;
        page.btnCopy.disabled = true;
        page.btnDownload.disabled = true;
        return;
    }

    // Older rows may contain an absolute server path instead of a public URL.
    const filename = url.split(/[\\/]/).pop();
    currentImageUrl = url.startsWith("/upload/") ? url : `/upload/${filename}`;

    page.preview.innerHTML = `<img src="${currentImageUrl}" alt="Clipboard Image" />`;

    page.btnCopy.disabled = false;
    page.btnDownload.disabled = false;
}

async function save() {
    console.log(`Received save request on readyForEdit = ${readyForEdit}`);
    if (!readyForEdit || !websocket || websocket.readyState !== WebSocket.OPEN) {
        updateStatus("WebSocket is not connected yet", "warning");
        return;
    }

    const content = page.textDisplayEdit.value;
    // const res = await fetch("/api/spaces/edit/" + spaceId, {
    //     method: "POST",
    //     headers: {"Content-Type": "application/json"},
    //     body: JSON.stringify({content})
    // })
    console.log("Edit task expects " + JSON.stringify({"type": "edit", "space_id": spaceId, "data": content}) + "to be sent");
    websocket.send(JSON.stringify({"type": "edit", "space_id": spaceId, "data": content}));

    // if (res.status === 404) return handleSpaceLost();
    updateSaveStatus(true)
    updateStatus("Content saved", "success");
    // await loadContent()
}

function startEditing() {
    // contentSaved = false;
    updateSaveStatus(false)
}


// ============ Status message update ============
const ALERT_TYPES = ["success", "info", "warning", "danger", "primary", "secondary", "light", "dark"];

function updateStatus(text, type = "secondary") {
    if (!ALERT_TYPES.includes(type)) type = "secondary";
    page.alertSpaceStatus.textContent = text;
    page.alertSpaceStatus.className = `alert alert-${type} mt-3 mb-4 py-2`;
}

function updateSaveStatus(status) {
    contentSaved = status;
    // console.log(spaceId + "Saved? " + status)
    page.labelSaved.innerHTML = status ? "Saved" : "Unsaved";
}
