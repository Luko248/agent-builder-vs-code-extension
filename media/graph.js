/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();
let snapshot = { agents: [], skills: [], edges: [] };
let selectedAgentId;
let selectedEdgeId;
let connectingFrom;
let dragState;

const $ = (selector) => document.querySelector(selector);
const nodesElement = $("#nodes");
const edgesElement = $("#edges");
const inspector = $("#inspector");
const canvasShell = $("#canvas-shell");

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function providerLabel(provider) {
  return provider === "claude" ? "Claude" : provider === "github" ? "GitHub Copilot" : "Codex";
}

function render(selectId) {
  $("#stats").textContent = `${snapshot.agents.length} agents · ${snapshot.skills.length} skills · ${snapshot.edges.length} connections`;
  $("#empty").classList.toggle("hidden", snapshot.agents.length !== 0);
  $("#canvas").classList.toggle("hidden", snapshot.agents.length === 0);
  nodesElement.replaceChildren();
  for (const agent of snapshot.agents) nodesElement.append(createNode(agent));
  renderEdges();
  if (selectId && snapshot.agents.some((agent) => agent.id === selectId)) selectedAgentId = selectId;
  if (selectedAgentId && !snapshot.agents.some((agent) => agent.id === selectedAgentId)) selectedAgentId = undefined;
  if (selectedEdgeId && !snapshot.edges.some((edge) => edge.id === selectedEdgeId)) selectedEdgeId = undefined;
  updateSelection();
}

function createNode(agent) {
  const card = document.createElement("article");
  card.className = `agent-card provider-${agent.provider}`;
  card.dataset.id = agent.id;
  card.style.left = `${agent.position.x}px`;
  card.style.top = `${agent.position.y}px`;
  card.style.setProperty("--agent-color", agent.color);
  const tools = agent.tools.slice(0, 3).map((tool) => `<span>${escapeHtml(tool)}</span>`).join("");
  const more = agent.tools.length > 3 ? `<span>+${agent.tools.length - 3}</span>` : "";
  card.innerHTML = `
    <div class="agent-accent"></div>
    <div class="agent-head drag-handle">
      <span class="provider-dot"></span>
      <span class="provider-name">${providerLabel(agent.provider)}</span>
      <span class="invoke-state" title="${agent.userInvokable ? "User invokable" : "Subagent only"}">${agent.userInvokable ? "USER" : "SUB"}</span>
    </div>
    <div class="agent-body">
      <h3>${escapeHtml(agent.title)}</h3>
      <p>${escapeHtml(agent.description || "No description yet")}</p>
      <div class="chips">${tools}${more}</div>
    </div>
    <footer><span>${escapeHtml(agent.model || "inherits model")}</span><button class="connect-port" title="Connect this agent to a subagent" aria-label="Connect ${escapeHtml(agent.title)}">→</button></footer>`;
  card.addEventListener("click", (event) => {
    if (event.target.closest(".connect-port")) return;
    if (connectingFrom) {
      if (connectingFrom !== agent.id) {
        vscode.postMessage({ type: "addEdge", source: connectingFrom, target: agent.id });
        connectingFrom = undefined;
        $("#connect-banner").classList.add("hidden");
      }
      return;
    }
    selectedAgentId = agent.id;
    selectedEdgeId = undefined;
    updateSelection();
  });
  card.querySelector(".connect-port").addEventListener("click", (event) => {
    event.stopPropagation();
    connectingFrom = agent.id;
    $("#connect-banner").classList.remove("hidden");
    updateSelection();
  });
  card.querySelector(".drag-handle").addEventListener("pointerdown", startDrag);
  return card;
}

function renderEdges() {
  edgesElement.querySelectorAll("path.edge, path.edge-hit, text.edge-label").forEach((element) => element.remove());
  for (const edge of snapshot.edges) {
    const source = snapshot.agents.find((agent) => agent.id === edge.source);
    const target = snapshot.agents.find((agent) => agent.id === edge.target);
    if (!source || !target) continue;
    const sx = source.position.x + 268;
    const sy = source.position.y + 96;
    const tx = target.position.x;
    const ty = target.position.y + 96;
    const bend = Math.max(90, Math.abs(tx - sx) * 0.45);
    const pathData = `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
    const path = svg("path", { d: pathData, class: `edge ${edge.style === "dashed" ? "dashed" : ""} ${selectedEdgeId === edge.id ? "selected" : ""}`, "marker-end": "url(#arrow)" });
    const hit = svg("path", { d: pathData, class: "edge-hit", "data-edge": edge.id });
    hit.addEventListener("click", () => {
      selectedEdgeId = edge.id;
      selectedAgentId = undefined;
      updateSelection();
    });
    edgesElement.append(path, hit);
    const label = svg("text", { x: String((sx + tx) / 2), y: String((sy + ty) / 2 - 9), class: "edge-label", "text-anchor": "middle" });
    label.textContent = edge.label;
    edgesElement.append(label);
  }
}

function svg(name, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function updateSelection() {
  document.querySelectorAll(".agent-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.id === selectedAgentId);
    card.classList.toggle("connecting", card.dataset.id === connectingFrom);
  });
  renderEdges();
  const agent = snapshot.agents.find((item) => item.id === selectedAgentId);
  const edge = snapshot.edges.find((item) => item.id === selectedEdgeId);
  if (agent) renderAgentInspector(agent);
  else if (edge) renderEdgeInspector(edge);
  else inspector.innerHTML = `<div class="inspector-empty"><span>◇</span><p>Select an agent or connection to edit it.</p></div><section class="skill-overview"><h3>Discovered skills</h3>${snapshot.skills.length ? snapshot.skills.map((skill) => `<div class="skill-row"><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.provider)} · ${escapeHtml(skill.file)}</small></div>`).join("") : "<p>No SKILL.md files found.</p>"}</section>`;
}

function renderAgentInspector(agent) {
  const permissionOptions = agent.provider === "claude"
    ? ["", "default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "plan"]
    : agent.provider === "codex"
      ? ["", "read-only", "workspace-write", "danger-full-access"]
      : [""];
  const skillOptions = snapshot.skills.map((skill) => `
    <label class="check-row"><input type="checkbox" name="skills" value="${escapeHtml(skill.name)}" ${agent.skills.includes(skill.name) ? "checked" : ""}/><span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.provider)} · ${escapeHtml(skill.description)}</small></span></label>`).join("");
  inspector.innerHTML = `
    <div class="inspector-title"><div><span class="eyebrow">${providerLabel(agent.provider)} agent</span><h2>${escapeHtml(agent.title)}</h2></div><button id="open-source" class="icon-button" title="Open ${escapeHtml(agent.file)}">↗</button></div>
    <div class="file-path">${escapeHtml(agent.file)}</div>
    <form id="agent-form">
      <label>Display title<input name="title" value="${escapeHtml(agent.title)}" required /></label>
      <label>Agent identifier<input name="name" value="${escapeHtml(agent.name)}" required /></label>
      <label>Description<textarea name="description" rows="3">${escapeHtml(agent.description)}</textarea></label>
      <div class="two-column"><label>Color<input name="color" value="${escapeHtml(agent.color)}" placeholder="#7C5CFC or purple" /></label><label>Model<input name="model" value="${escapeHtml(agent.model || "")}" placeholder="inherit" /></label></div>
      ${agent.provider !== "github" ? `<label>Permission mode<select name="permissionMode">${permissionOptions.map((option) => `<option value="${option}" ${agent.permissionMode === option ? "selected" : ""}>${option || "inherit"}</option>`).join("")}</select></label>` : ""}
      <label>Tools <small>${agent.provider === "codex" ? "Recorded as requested capabilities; Codex runtime config governs actual access." : "Native tool allowlist."}</small><input name="tools" value="${escapeHtml(agent.tools.join(", "))}" placeholder="Read, Search, Edit" /></label>
      <fieldset><legend>Invocation</legend><label class="toggle"><input type="checkbox" name="userInvokable" ${agent.userInvokable ? "checked" : ""}/><span>User can invoke directly</span></label><label class="toggle"><input type="checkbox" name="autoInvokable" ${agent.autoInvokable ? "checked" : ""}/><span>Model can select automatically</span></label></fieldset>
      <fieldset class="skills-field"><legend>Assigned skills</legend>${skillOptions || "<p>Create a skill to assign reusable workflows.</p>"}</fieldset>
      <label>Agent prompt<textarea name="prompt" rows="12" class="prompt-editor">${escapeHtml(agent.prompt)}</textarea></label>
      <button class="primary wide" type="submit">Save agent & synchronize source</button>
    </form>`;
  $("#open-source").addEventListener("click", () => vscode.postMessage({ type: "openSource", file: agent.file }));
  $("#agent-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = structuredClone(agent);
    next.title = String(form.get("title") || "").trim();
    next.name = String(form.get("name") || "").trim();
    next.description = String(form.get("description") || "").trim();
    next.color = String(form.get("color") || agent.color);
    next.model = String(form.get("model") || "").trim() || undefined;
    next.permissionMode = String(form.get("permissionMode") || "").trim() || undefined;
    next.tools = String(form.get("tools") || "").split(",").map((item) => item.trim()).filter(Boolean);
    next.skills = form.getAll("skills").map(String);
    next.userInvokable = Boolean(form.get("userInvokable"));
    next.autoInvokable = Boolean(form.get("autoInvokable"));
    next.prompt = String(form.get("prompt") || "").trim();
    vscode.postMessage({ type: "saveAgent", agent: next });
  });
}

function renderEdgeInspector(edge) {
  const source = snapshot.agents.find((agent) => agent.id === edge.source);
  const target = snapshot.agents.find((agent) => agent.id === edge.target);
  inspector.innerHTML = `
    <div class="inspector-title"><div><span class="eyebrow">Delegation</span><h2>${escapeHtml(source?.title)} → ${escapeHtml(target?.title)}</h2></div></div>
    <form id="edge-form">
      <label>When should the target run?<textarea name="label" rows="4">${escapeHtml(edge.label)}</textarea></label>
      <label>Line style<select name="style"><option value="solid" ${edge.style !== "dashed" ? "selected" : ""}>Solid</option><option value="dashed" ${edge.style === "dashed" ? "selected" : ""}>Dashed</option></select></label>
      <p class="help">Saving updates the graph manifest and the managed orchestration block in <code>${escapeHtml(source?.file)}</code>.</p>
      <button class="primary wide" type="submit">Save connection</button>
      <button id="delete-edge" class="danger wide" type="button">Remove connection</button>
    </form>`;
  $("#edge-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    vscode.postMessage({ type: "updateEdge", edge: { ...edge, label: String(form.get("label") || "").trim(), style: form.get("style") } });
  });
  $("#delete-edge").addEventListener("click", () => vscode.postMessage({ type: "deleteEdge", id: edge.id }));
}

function startDrag(event) {
  if (event.button !== 0) return;
  const card = event.currentTarget.closest(".agent-card");
  const agent = snapshot.agents.find((item) => item.id === card.dataset.id);
  if (!agent) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  dragState = { agent, card, startX: event.clientX, startY: event.clientY, originX: agent.position.x, originY: agent.position.y };
  event.currentTarget.addEventListener("pointermove", moveDrag);
  event.currentTarget.addEventListener("pointerup", endDrag, { once: true });
}

function moveDrag(event) {
  if (!dragState) return;
  dragState.agent.position.x = Math.max(20, dragState.originX + event.clientX - dragState.startX);
  dragState.agent.position.y = Math.max(20, dragState.originY + event.clientY - dragState.startY);
  dragState.card.style.left = `${dragState.agent.position.x}px`;
  dragState.card.style.top = `${dragState.agent.position.y}px`;
  renderEdges();
}

function endDrag(event) {
  event.currentTarget.removeEventListener("pointermove", moveDrag);
  dragState = undefined;
  saveLayout();
}

function autoLayout() {
  const indegree = new Map(snapshot.agents.map((agent) => [agent.id, 0]));
  const outgoing = new Map(snapshot.agents.map((agent) => [agent.id, []]));
  for (const edge of snapshot.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const level = new Map();
  const queue = snapshot.agents.filter((agent) => indegree.get(agent.id) === 0).map((agent) => agent.id);
  for (const id of queue) level.set(id, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const target of outgoing.get(id) || []) {
      level.set(target, Math.max(level.get(target) || 0, (level.get(id) || 0) + 1));
      indegree.set(target, (indegree.get(target) || 1) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  let fallbackLevel = Math.max(0, ...level.values());
  for (const agent of snapshot.agents) if (!level.has(agent.id)) level.set(agent.id, fallbackLevel++);
  const rows = new Map();
  for (const agent of snapshot.agents) {
    const column = level.get(agent.id) || 0;
    const row = rows.get(column) || 0;
    agent.position = { x: 80 + column * 360, y: 80 + row * 240 };
    rows.set(column, row + 1);
  }
  render();
  saveLayout();
}

function saveLayout() {
  vscode.postMessage({ type: "saveLayout", positions: Object.fromEntries(snapshot.agents.map((agent) => [agent.id, agent.position])) });
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), 2600);
}

window.addEventListener("message", (event) => {
  if (event.data.type === "snapshot") {
    snapshot = event.data.snapshot;
    render(event.data.selectId);
  } else if (event.data.type === "saved") toast(event.data.message);
  else if (event.data.type === "error") toast(event.data.message, true);
});

$("#refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
$("#create-agent").addEventListener("click", () => vscode.postMessage({ type: "createAgent" }));
$("#empty-create").addEventListener("click", () => vscode.postMessage({ type: "createAgent" }));
$("#create-skill").addEventListener("click", () => vscode.postMessage({ type: "createSkill" }));
$("#auto-layout").addEventListener("click", autoLayout);
$("#cancel-connect").addEventListener("click", () => { connectingFrom = undefined; $("#connect-banner").classList.add("hidden"); updateSelection(); });
canvasShell.addEventListener("click", (event) => {
  if (event.target === canvasShell || event.target.id === "canvas") {
    selectedAgentId = undefined;
    selectedEdgeId = undefined;
    updateSelection();
  }
});
vscode.postMessage({ type: "ready" });
