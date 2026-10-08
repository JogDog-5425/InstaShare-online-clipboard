// ============ Global variables ============
let spaceId;
let contentSaved = false;
let readyForEdit = false;
let shouldFlush = false;  // This happens when page is stuck by modal

// Cached elements
let page = {
    alertSpaceStatus: document.getElementById("spaceStatus"),
    labelShareSpaceId: document.getElementById("labelShareSpaceId"),
    labelLastTimeUpdated: document.getElementById("timeLastUpdate"),
    labelSaved: document.getElementById("labelSaved"),
    labelConnectionStatus: document.getElementById("connectionStatus"),
    textDisplayEdit: document.getElementById("textDisplayEdit")
}


// // Flush the page when necessary (obsolete)
// setInterval(async () => {await flush()}, 2);


// ============ EES ============
// [Obsolete] Use SSE to update only when necessary
let eventSource = null;

function connectSSE(spaceId) {
    console.log("connected")
    page.labelConnectionStatus.innerHTML = "Subscribed";
    eventSource = new EventSource("/api/spaces/" + spaceId + "/events")
    eventSource.addEventListener("contentModified", flush)
}

function disconnectEES() {
    if (!eventSource) return;
    console.log("disconnected")
    page.labelConnectionStatus.innerHTML = "Unsubscribed";
    eventSource.close();
    eventSource = null;
}


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
    websocket = new WebSocket(`${protocol}://${location.host}/api/spaces/ws`);

    websocket.onopen = () => {
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
            websocket.send(JSON.stringify({type: "sync", "space_id": spaceId}));
        }
    };

    websocket.onmessage = (eventData) => {
        onMessageReceived(eventData);
    };

    websocket.onclose = () => {
        wsConnected = false;
        updateStatus("You are now offline", "warning");
        page.labelConnectionStatus.textContent = "Disconnected";

        if (manualClose) return;  // Do not reconnect when connection is normal
        tryReconnect();
    };

    websocket.onerror = () => {
        if (websocket) websocket.close();  // Make sure onclose is called (this should trigger reconnection)
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
    // console.log("Received websocket message");
    const message = JSON.parse(eventData.data);

    if (message.type === "update") {
        console.log("Should update");
        await loadContent(message.data);
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


// ============ Actions ============
async function enterSpace() {
    if (!wsConnected) return;
    readyForEdit = false;
    const id = document.getElementById("inputShareSpaceId").value;

    if (!id) return;

    const res = await fetch("/api/spaces/verify/" + id);  // Get: Bool

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
    console.log("Should load content from " + JSON.stringify(spaceData));

    spaceId = spaceData.space_id;
    // console.log("New space id: " + spaceId);
    page.labelShareSpaceId.innerHTML = spaceId;
    page.labelLastTimeUpdated.innerHTML = spaceData.last_updated;
    page.textDisplayEdit.value = spaceData.content;

    readyForEdit = true;
}

async function save() {
    console.log(`Received save request on readyForEdit = ${readyForEdit}`);
    if (!readyForEdit) return;

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


// ============ Page rendering ============
// [Obsolete]
async function flush() {
    // if (!contentSaved) return;
    // todo version conflict handling
    console.log("Content is now up to date!")
    await loadContent()
    console.log("Content is now up to date!")
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
