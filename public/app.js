"use strict";

const byId = (id) => document.getElementById(id);
const login = byId("login");
const board = byId("board");
const detail = byId("detail");
const owner = byId("owner");
const solved = byId("solved");
const vinSelect = byId("vin");

const loginForm = byId("login-form");
let accessKey = new URLSearchParams(location.hash.slice(1)).get("acceso");
let snapshot;
let chosenVin = "";
let activeItem;
let activityKey = "";
let boardKey = "";
let pending = false;
let currentRead;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function api(path, body) {
  const options = {};
  if (body !== undefined) {
    options.method = "POST";
    options.headers = {"X-Zetros-Request": "1"};
    if (body instanceof Blob) {
      options.body = body;
    } else {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
  }
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/join") showLogin();
    throw new Error(result.error);
  }
  return result;
}

function showLogin() {
  if (detail.open) detail.close();
  board.hidden = true;
  byId("session").hidden = true;
  login.hidden = false;
  loginForm.hidden = !accessKey;
  byId("link-required").hidden = Boolean(accessKey);
  snapshot = undefined;
  chosenVin = "";
  vinSelect.value = "";
  boardKey = "";
  byId("items").replaceChildren();
  byId("references").replaceChildren();
  byId("history").replaceChildren();
  byId("username").textContent = "";
}

function state(item) {
  return snapshot.states[item.id] || {owner: "", solved: 0};
}

function setOptions(select, initial, names) {
  select.replaceChildren(...initial.map(([label, value]) => new Option(label, value)));
  for (const name of names) select.add(new Option(name, name));
}

function normalize(value) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

const percent = new Intl.NumberFormat("es-CL", {
  style: "percent", maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat("es-CL");

function showProgress(progressId, labelId, solved, total) {
  const bar = byId(progressId);
  bar.hidden = false;
  bar.max = total;
  bar.value = solved;
  byId(labelId).textContent = `${percent.format(solved / total)} · ${number.format(solved)} de ${number.format(total)} resueltos`;
}

function renderBoard() {
  if (!snapshot) return;
  const {items, states, vehicles, vin, fleetSolved} = snapshot;
  showProgress("fleet-progress", "fleet-label", fleetSolved, items.length * vehicles.length);
  const ready = Boolean(vin && vin === chosenVin);
  byId("filters").hidden = !ready;
  byId("vehicle-status").hidden = ready;
  if (!ready) {
    byId("progress").hidden = true;
    byId("progress-label").textContent = chosenVin ? "Cargando avance…" : "Selecciona un VIN";
    byId("vehicle-status").textContent = chosenVin
      ? "Cargando puntos del vehículo…"
      : "Selecciona un VIN para ver sus puntos de revisión.";
    byId("items").replaceChildren();
    boardKey = "";
    return;
  }

  const count = Object.values(states).filter((item) => item.solved).length;
  showProgress("progress", "progress-label", count, items.length);

  const query = normalize(byId("search").value.trim());
  const statusFilter = byId("filter-status").value;
  const ownerFilter = byId("filter-owner").value;
  const list = byId("items");
  const key = JSON.stringify([vin, states, query, statusFilter, ownerFilter]);
  if (key === boardKey) return;
  boardKey = key;

  const focused = document.activeElement?.dataset.item;
  const fragment = document.createDocumentFragment();
  let category = "";
  for (const item of items) {
    const current = state(item);
    if (!normalize(`${item.id} ${item.category} ${item.description}`).includes(query)) continue;
    if (statusFilter && (current.solved ? "done" : "open") !== statusFilter) continue;
    if (ownerFilter && (current.owner || "unassigned") !== ownerFilter) continue;
    if (category !== item.category) {
      category = item.category;
      fragment.append(element("h3", category));
    }
    const button = element("button", null, "row");
    button.type = "button";
    button.dataset.item = item.id;
    button.append(
      element("span", item.id, "row-id"),
      element("span", item.description),
      element("span", current.owner || "Sin asignar", "caption"),
      element("span", current.solved ? "Solucionado" : "Pendiente", current.solved ? "status done" : "status"),
    );
    button.addEventListener("click", () => openItem(item));
    fragment.append(button);
  }
  if (!fragment.childNodes.length) fragment.append(element("p", "No hay puntos que coincidan con los filtros."));
  list.replaceChildren(fragment);
  if (focused) findRow(focused)?.focus({preventScroll: true});
}

function findRow(id) {
  return [...byId("items").querySelectorAll(".row")].find((row) => row.dataset.item === id);
}

function photoLink(url, alt) {
  const link = element("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  const photo = element("img");
  photo.src = url;
  photo.alt = alt;
  photo.loading = "lazy";
  link.append(photo);
  return link;
}

function activityPath(item, action) {
  return `/api/${item.id}/${action}?vin=${encodeURIComponent(item.vin)}`;
}

function renderActivity(events, vin) {
  const key = JSON.stringify(events);
  if (key === activityKey) return;
  activityKey = key;
  const history = byId("history");
  history.replaceChildren();
  if (!events.length) history.append(element("p", "Aún no hay actividad.", "caption"));
  for (const event of events) {
    const entry = element("article", null, "event");
    const date = new Date(event.time).toLocaleString("es-CL", {dateStyle: "short", timeStyle: "short"});
    entry.append(element("div", `${event.author} · ${date}`, "caption"));
    if (event.kind === "photo") {
      entry.append(photoLink(`/photos/${event.id}?vin=${encodeURIComponent(vin)}`, `Foto de avance de ${event.author}`));
    } else {
      entry.append(element("p", event.body));
    }
    history.append(entry);
  }
}

function syncControls() {
  if (!activeItem || snapshot?.vin !== activeItem.vin) return;
  const current = state(activeItem);
  owner.value = current.owner;
  solved.checked = Boolean(current.solved);
}

async function refresh() {
  if (currentRead) return currentRead;
  currentRead = loadBoard();
  try {
    await currentRead;
  } finally {
    currentRead = undefined;
  }
}

async function loadBoard() {
  try {
    const first = board.hidden;
    const vin = chosenVin;
    const next = await api(vin ? `/api/board?vin=${encodeURIComponent(vin)}` : "/api/board");
    if (vin !== chosenVin) return;
    snapshot = next;
    byId("notice").textContent = "";
    if (first) {
      setOptions(vinSelect, [["Selecciona un vehículo", ""]], snapshot.vehicles);
      setOptions(byId("filter-owner"), [["Todos", ""], ["Sin asignar", "unassigned"]], snapshot.owners);
      setOptions(owner, [["Sin asignar", ""]], snapshot.owners);
    }
    if (accessKey) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    login.hidden = true;
    board.hidden = false;
    byId("session").hidden = false;
    byId("username").textContent = snapshot.user;
    renderBoard();
    if (detail.open && activeItem && !pending) {
      if (document.activeElement !== owner && document.activeElement !== solved) syncControls();
      await refreshActivity(activeItem);
    }
  } catch (error) {
    if (snapshot || login.hidden) byId("notice").textContent = error.message;
  }
}

async function refreshActivity(item) {
  const events = await api(activityPath(item, "activity"));
  if (detail.open && item === activeItem) renderActivity(events, item.vin);
}

function openItem(item) {
  if (!snapshot?.vin || snapshot.vin !== chosenVin) return;
  activeItem = {...item, vin: snapshot.vin};
  activityKey = "";
  byId("history").replaceChildren();
  byId("detail-notice").textContent = "";
  byId("comment-form").reset();
  byId("photo-form").reset();
  byId("detail-meta").textContent = `${item.category} · VIN ${activeItem.vin} · Excel, fila ${item.row}`;
  byId("detail-title").textContent = `Punto ${item.id}`;
  byId("description").textContent = item.description;
  syncControls();
  const photos = item.photos.map((name, index) => photoLink(`/reference/${name}`, `Referencia ${index + 1} del punto ${item.id}`));
  for (const name of item.categoryPhotos ?? []) {
    const reference = photoLink(`/reference/${name}`, `Foto de referencia de la categoría ${item.category}`);
    reference.append(element("span", "Referencia de la categoría", "caption"));
    photos.push(reference);
  }
  byId("references").replaceChildren(...(photos.length ? photos : [element("p", "El Excel no incluye una foto para este punto.", "caption")]));
  detail.showModal();
  const opened = activeItem;
  refreshActivity(opened).catch((error) => {
    if (activeItem === opened) byId("detail-notice").textContent = error.message;
  });
}

async function mutate(action, operation) {
  if (pending) return;
  pending = true;
  const item = activeItem;
  const message = byId("detail-notice");
  message.textContent = "";
  const controls = [...detail.querySelectorAll("button, input, select, textarea")];
  controls.forEach((control) => { control.disabled = true; });
  try {
    await operation(item);
    message.textContent = action;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    pending = false;
    controls.forEach((control) => { control.disabled = false; });
    await currentRead;
    await refresh();
    syncControls();
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const data = new FormData(event.currentTarget);
  button.disabled = true;
  byId("notice").textContent = "";
  try {
    await api("/api/join", {name: data.get("name"), key: accessKey});
    loginForm.reset();
    await refresh();
  } catch (error) {
    byId("notice").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

byId("logout").addEventListener("click", async () => {
  try {
    await currentRead;
    await api("/api/logout", {});
    accessKey = null;
    showLogin();
    byId("notice").textContent = "";
  } catch (error) {
    byId("notice").textContent = error.message;
  }
});

vinSelect.addEventListener("change", async () => {
  const vin = vinSelect.value;
  chosenVin = vin;
  renderBoard();
  await currentRead;
  if (chosenVin === vin && !board.hidden) await refresh();
});

for (const filter of ["search", "filter-status", "filter-owner"]) {
  byId(filter).addEventListener("input", renderBoard);
}
byId("close-detail").addEventListener("click", () => detail.close());
detail.addEventListener("cancel", (event) => { if (pending) event.preventDefault(); });
detail.addEventListener("close", () => {
  if (activeItem) findRow(activeItem.id)?.focus();
  activeItem = undefined;
});
owner.addEventListener("change", () => mutate("Responsable guardado.", (item) => api(activityPath(item, "state"), {owner: owner.value})));
solved.addEventListener("change", () => mutate("Estado guardado.", (item) => api(activityPath(item, "state"), {solved: solved.checked})));

byId("comment-form").addEventListener("submit", (event) => {
  event.preventDefault();
  mutate("Comentario publicado.", async (item) => {
    await api(activityPath(item, "comment"), {body: byId("comment").value});
    byId("comment-form").reset();
  });
});

async function preparePhoto(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", {alpha: false});
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.68, 0.5, 0.32]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= 750000) return blob;
    }
    throw new Error("La foto supera el tamaño permitido.");
  } finally {
    bitmap.close();
  }
}

byId("photo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const selected = [...byId("files").files];
  mutate("Fotos guardadas.", async (item) => {
    let uploaded = 0;
    try {
      for (const file of selected) {
        await api(activityPath(item, "photo"), await preparePhoto(file));
        uploaded++;
      }
    } catch (error) {
      const remaining = new DataTransfer();
      selected.slice(uploaded).forEach((file) => remaining.items.add(file));
      byId("files").files = remaining.files;
      throw new Error(`${uploaded} de ${selected.length} fotos guardadas. ${error.message}`);
    }
    byId("photo-form").reset();
  });
});

refresh();
setInterval(() => {
  if (!document.hidden && !board.hidden && !pending) refresh();
}, 15000);
