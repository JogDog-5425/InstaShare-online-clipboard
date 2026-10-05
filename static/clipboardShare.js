// Global variables
let spaceId;
let contentSaved;
let shouldFlush = false;  // This happens when page is stuck by modal
let eventSource = null;

// Cached elements
let page = {
    alertSpaceStatus: document.getElementById("spaceStatus"),
    labelShareSpaceId: document.getElementById("labelShareSpaceId"),
    labelLastTimeUpdated: document.getElementById("timeLastUpdate"),
    labelSaved: document.getElementById("labelSaved"),
    labelSseStatus: document.getElementById("sseStatus"),
    textDisplayEdit: document.getElementById("textDisplayEdit")
}

// // Flush the page when necessary (obsolete)
// setInterval(async () => {await flush()}, 2);

// ===== EES =====
// Use SSE to update only when necessary
function connectSSE(spaceId) {
    console.log("connected")
    page.labelSseStatus.innerHTML = "Subscribed";
    eventSource = new EventSource("/api/spaces/" + spaceId + "/events")
    eventSource.addEventListener("contentModified", flush)
}

function disconnectEES() {
    if (!eventSource) return;
    console.log("disconnected")
    page.labelSseStatus.innerHTML = "Unsubscribed";
    eventSource.close();
    eventSource = null;
}

// ===== Actions =====
async function enterSpace()
{
    console.warn("We've entered!")
    const id = document.getElementById("inputShareSpaceId").value;

    if (!id) return;
    const res = await fetch("/api/spaces/verify/" + id);

    if (await res.json()) {
        // Connect and load
        spaceId = id;
        updateStatus("Getting you connected to Space " + id, "info");
        await loadContent();
    } else {
        // Confirm space creation
        const doCreate = confirm("There is no existing Space " + id + ". Would you like to create a new one?")
        if (doCreate) {
            spaceId = id;
            await create()
        } else {
            return;
        }
    }
    updateStatus("Connected to Space " + id, "success");
    page.labelShareSpaceId.innerHTML = spaceId;
    disconnectEES()
    connectSSE(spaceId)

    updateSaveStatus(true)
    // shouldFlush = true;
}

async function create() {
    // Send the post request
    const res = await fetch("/api/spaces/create/" + spaceId, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({})
    })
    const creationResult = await res.json()
    console.log(creationResult)
    updateStatus("Getting you connected to Space " + spaceId, "info");
    if (creationResult.success) {
        // todo creation success message + show content
        alert("Space " + spaceId + " has been created. ")
        updateStatus("Getting you connected to Space " + spaceId, "info");

        const spaceData = await (await fetch("/api/spaces/" + spaceId)).json()
        await loadContent(spaceData)
    } else {
        alert("Cannot create space.")
    }

    updateSaveStatus(true)
}

async function loadContent(spaceData = null) {
    if (spaceData == null) {
        const res = await fetch("/api/spaces/" + spaceId);
        // if (res.status === 404) return handleSpaceLost();
        spaceData = await res.json();
    }
    spaceId = spaceData.space_id;
    // console.log("New space id: " + spaceId);
    page.labelShareSpaceId.innerHTML = spaceId;
    page.labelLastTimeUpdated.innerHTML = spaceData.last_updated;
    page.textDisplayEdit.value = spaceData.content;
}

async function save() {
    const content = document.getElementById("textDisplayEdit").value;
    const res = await fetch("/api/spaces/edit/" + spaceId, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({content})
    })
    // if (res.status === 404) return handleSpaceLost();
    updateSaveStatus(true)
    updateStatus("Content saved", "success");
    await loadContent()
}

function startEditing() {
    // contentSaved = false;
    updateSaveStatus(false)
}

// ===== Page rendering =====
async function flush() {
    // if (!contentSaved) return;
    // todo version conflict handling
    console.log("Content is now up to date!")
    await loadContent()
    console.log("Content is now up to date!")
}

// Status message update
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
