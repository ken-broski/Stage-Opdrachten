const loginView = document.querySelector("#login-view");
const adminView = document.querySelector("#admin-view");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const eventForm = document.querySelector("#event-form");
const eventMessage = document.querySelector("#event-message");
const categoryForm = document.querySelector("#category-form");
const categoryMessage = document.querySelector("#category-message");
const eventTable = document.querySelector("#events-table");
const categoryList = document.querySelector("#category-list");
const participantsPanel = document.querySelector("#participants-panel");

let categories = [];
let events = [];
let editingEventId = null;
let editingCategoryId = null;
let selectedEventId = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Er ging iets mis. Probeer het opnieuw.");
  return payload;
}

function jsonOptions(method, data) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

function announce(node, message, success = false) {
  node.textContent = message;
  node.classList.toggle("success", success);
}

function toLocalDateTime(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function statusLabel(status) {
  return { draft: "Concept", published: "Gepubliceerd", cancelled: "Geannuleerd" }[status] || status;
}

function statusClass(status) {
  return `status-tag${status === "draft" ? " status-draft" : status === "cancelled" ? " status-cancelled" : ""}`;
}

async function loadData() {
  const [dashboard, nextCategories, nextEvents] = await Promise.all([
    request("/api/admin/dashboard"),
    request("/api/admin/categories"),
    request("/api/admin/events")
  ]);
  categories = nextCategories;
  events = nextEvents;
  document.querySelector("#upcoming-count").textContent = dashboard.upcoming_events;
  document.querySelector("#registration-count").textContent = dashboard.active_registrations;
  renderCategories();
  renderEvents();
}

function renderCategories() {
  const select = eventForm.elements.category_id;
  const selectedValue = select.value;
  select.replaceChildren();
  categories.forEach((category) => {
    const option = element("option", "", category.name);
    option.value = category.id;
    select.append(option);
  });
  if (categories.some((category) => String(category.id) === selectedValue)) select.value = selectedValue;

  categoryList.replaceChildren();
  categories.forEach((category) => {
    const row = element("div", "category-item");
    row.append(element("span", "", category.name));
    const edit = element("button", "table-button", "Wijzigen");
    edit.type = "button";
    edit.addEventListener("click", () => startCategoryEdit(category));
    row.append(edit);
    categoryList.append(row);
  });
  eventForm.elements.category_id.disabled = categories.length === 0;
}

function renderEvents() {
  eventTable.replaceChildren();
  if (events.length === 0) {
    const row = element("tr");
    const cell = element("td", "", "Nog geen activiteiten aangemaakt.");
    cell.colSpan = 5;
    row.append(cell);
    eventTable.append(row);
    return;
  }

  events.forEach((event) => {
    const row = element("tr");
    row.append(element("td", "", event.title), element("td", "", formatDate(event.date_time)));
    const statusCell = element("td");
    statusCell.append(element("span", statusClass(event.status), statusLabel(event.status)));
    row.append(statusCell, element("td", "", `${event.active_registrations} / ${event.capacity}`));
    const actions = element("div", "table-actions");
    const edit = element("button", "table-button", "Wijzigen");
    edit.type = "button";
    edit.addEventListener("click", () => startEventEdit(event));
    const people = element("button", "table-button", "Deelnemers");
    people.type = "button";
    people.addEventListener("click", () => showParticipants(event));
    const csv = element("a", "table-button", "Download CSV");
    csv.href = `/api/admin/events/${event.id}/csv`;
    csv.setAttribute("download", "");
    actions.append(edit, people, csv);
    const actionsCell = element("td");
    actionsCell.append(actions);
    row.append(actionsCell);
    eventTable.append(row);
  });
}

async function showParticipants(event) {
  selectedEventId = event.id;
  participantsPanel.hidden = false;
  participantsPanel.replaceChildren(element("h3", "", `Deelnemers · ${event.title}`), element("p", "", "Lijst laden…"));
  try {
    const people = await request(`/api/admin/events/${event.id}/registrations`);
    if (selectedEventId !== event.id) return;
    participantsPanel.replaceChildren(element("h3", "", `Deelnemers · ${event.title}`));
    if (people.length === 0) {
      participantsPanel.append(element("p", "", "Er zijn nog geen aanmeldingen."));
      return;
    }
    people.forEach((person) => {
      const row = element("div", "participant-item");
      const details = element("div");
      details.append(element("strong", "", person.name), element("span", "", person.email));
      const action = person.status === "active"
        ? element("button", "table-button table-button-danger", "Aanmelding annuleren")
        : element("span", "status-tag status-cancelled", "Geannuleerd");
      if (person.status === "active") {
        action.type = "button";
        action.addEventListener("click", async () => {
          action.disabled = true;
          try {
            await request(`/api/admin/registrations/${person.id}/cancel`, { method: "POST" });
            await Promise.all([loadData(), showParticipants(event)]);
          } catch (error) {
            announce(eventMessage, error.message);
            action.disabled = false;
          }
        });
      }
      row.append(details, action);
      participantsPanel.append(row);
    });
  } catch (error) {
    participantsPanel.replaceChildren(element("h3", "", "Deelnemers"), element("p", "", error.message));
  }
}

function startEventEdit(event) {
  editingEventId = event.id;
  eventForm.elements.title.value = event.title;
  eventForm.elements.category_id.value = event.category_id;
  eventForm.elements.date_time.value = toLocalDateTime(event.date_time);
  eventForm.elements.location.value = event.location;
  eventForm.elements.capacity.value = event.capacity;
  eventForm.elements.status.value = event.status;
  eventForm.elements.image_url.value = event.image_url || "";
  eventForm.elements.description.value = event.description;
  document.querySelector("#event-form-heading").textContent = "Activiteit wijzigen";
  document.querySelector("#save-event").textContent = "Wijzigingen opslaan";
  document.querySelector("#cancel-edit").hidden = false;
  eventMessage.textContent = "";
  eventForm.scrollIntoView({ behavior: "smooth", block: "start" });
  eventForm.elements.title.focus();
}

function resetEventForm() {
  editingEventId = null;
  eventForm.reset();
  document.querySelector("#event-form-heading").textContent = "Nieuwe activiteit";
  document.querySelector("#save-event").textContent = "Activiteit toevoegen";
  document.querySelector("#cancel-edit").hidden = true;
  if (categories.length) eventForm.elements.category_id.value = categories[0].id;
  eventForm.elements.status.value = "published";
}

function startCategoryEdit(category) {
  editingCategoryId = category.id;
  categoryForm.elements.name.value = category.name;
  document.querySelector("#save-category").textContent = "Wijzigingen opslaan";
  document.querySelector("#cancel-category-edit").hidden = false;
  categoryMessage.textContent = "";
  categoryForm.elements.name.focus();
}

function resetCategoryForm() {
  editingCategoryId = null;
  categoryForm.reset();
  document.querySelector("#save-category").textContent = "Categorie toevoegen";
  document.querySelector("#cancel-category-edit").hidden = true;
}

async function showAdmin(email) {
  loginView.hidden = true;
  adminView.hidden = false;
  document.querySelector("#welcome-email").textContent = email;
  try {
    await loadData();
    resetEventForm();
  } catch (error) {
    announce(eventMessage, error.message);
  }
}

async function start() {
  try {
    const employee = await request("/api/admin/me");
    if (employee.authenticated) {
      await showAdmin(employee.email);
    } else {
      loginView.hidden = false;
      adminView.hidden = true;
    }
  } catch (error) {
    announce(loginMessage, error.message);
    loginView.hidden = false;
    adminView.hidden = true;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  announce(loginMessage, "Inloggen…");
  const submit = loginForm.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const employee = await request("/api/admin/login", jsonOptions("POST", {
      email: loginForm.elements.email.value,
      password: loginForm.elements.password.value
    }));
    loginForm.reset();
    announce(loginMessage, "");
    await showAdmin(employee.email);
  } catch (error) {
    announce(loginMessage, error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", { method: "POST" });
    participantsPanel.hidden = true;
    adminView.hidden = true;
    loginView.hidden = false;
    announce(loginMessage, "Je bent uitgelogd.", true);
  } catch (error) {
    announce(eventMessage, error.message);
  }
});

document.querySelector("#reset-registrations").addEventListener("click", async (event) => {
  const confirmed = window.confirm("Weet je het zeker? Alle aanmeldingen, ook eerder geannuleerde, worden verwijderd. Activiteiten en categorieën blijven bestaan.");
  if (!confirmed) return;

  const button = event.currentTarget;
  const message = document.querySelector("#reset-message");
  button.disabled = true;
  announce(message, "Aanmeldingen wissen…");
  try {
    const result = await request("/api/admin/registrations/reset", { method: "POST" });
    participantsPanel.hidden = true;
    selectedEventId = null;
    await loadData();
    announce(message, `${result.deleted} ${result.deleted === 1 ? "aanmelding verwijderd" : "aanmeldingen verwijderd"}. De plekken zijn weer beschikbaar.`, true);
  } catch (error) {
    announce(message, error.message);
  } finally {
    button.disabled = false;
  }
});

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!eventForm.reportValidity()) return;
  const submit = document.querySelector("#save-event");
  submit.disabled = true;
  announce(eventMessage, "Opslaan…");
  const fields = eventForm.elements;
  const payload = {
    title: fields.title.value,
    category_id: Number(fields.category_id.value),
    date_time: new Date(fields.date_time.value).toISOString(),
    location: fields.location.value,
    capacity: Number(fields.capacity.value),
    status: fields.status.value,
    image_url: fields.image_url.value,
    description: fields.description.value
  };
  try {
    const editing = editingEventId !== null;
    const url = editing ? `/api/admin/events/${editingEventId}` : "/api/admin/events";
    await request(url, jsonOptions(editing ? "PUT" : "POST", payload));
    await loadData();
    resetEventForm();
    announce(eventMessage, editing ? "De activiteit is gewijzigd." : "De activiteit is toegevoegd.", true);
  } catch (error) {
    announce(eventMessage, error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#cancel-edit").addEventListener("click", resetEventForm);

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!categoryForm.reportValidity()) return;
  const submit = document.querySelector("#save-category");
  submit.disabled = true;
  announce(categoryMessage, "Opslaan…");
  try {
    const editing = editingCategoryId !== null;
    const url = editing ? `/api/admin/categories/${editingCategoryId}` : "/api/admin/categories";
    await request(url, jsonOptions(editing ? "PUT" : "POST", { name: categoryForm.elements.name.value }));
    await loadData();
    resetCategoryForm();
    announce(categoryMessage, editing ? "De categorie is gewijzigd." : "De categorie is toegevoegd.", true);
  } catch (error) {
    announce(categoryMessage, error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#cancel-category-edit").addEventListener("click", resetCategoryForm);
start();
