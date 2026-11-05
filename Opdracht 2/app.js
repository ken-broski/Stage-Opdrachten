const eventList = document.querySelector("#event-list");
const categorySelect = document.querySelector("#category");
const searchInput = document.querySelector("#search");
const listStatus = document.querySelector("#list-status");
const emptyState = document.querySelector("#empty-state");
const dialog = document.querySelector("#event-dialog");
const dialogContent = document.querySelector("#dialog-content");

let events = [];


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

function formatDate(value, options = { weekday: "long", day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat("nl-NL", options).format(new Date(value));
}

function filteredEvents() {
  const query = searchInput.value.trim().toLocaleLowerCase("nl");
  return events.filter((event) => {
    const matchesText = !query || event.title.toLocaleLowerCase("nl").includes(query);
    const matchesCategory = !categorySelect.value || String(event.category_id) === categorySelect.value;
    return matchesText && matchesCategory;
  });
}

function makeImage(event, className = "event-image") {
  const image = element("img", className);
  image.src = event.image_url || "/placeholder.svg";
  image.alt = event.title;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    const fallback = element("div", "event-image-fallback", "✳");
    fallback.setAttribute("aria-label", event.title);
    image.replaceWith(fallback);
  }, { once: true });
  return image;
}

function showEvents() {
  const visible = filteredEvents();
  eventList.replaceChildren();
  listStatus.textContent = `${visible.length} ${visible.length === 1 ? "activiteit" : "activiteiten"}`;
  emptyState.hidden = visible.length !== 0;

  visible.forEach((event) => {
    const card = element("article", "event-card");
    card.append(makeImage(event));
    const body = element("div", "event-body");
    body.append(element("span", "event-category", event.category_name));
    body.append(element("h3", "", event.title));

    const meta = element("ul", "event-meta");
    const dateRow = element("li");
    dateRow.append(element("span", "", "◷"), element("span", "", `${formatDate(event.date_time)} · ${formatDate(event.date_time, { hour: "2-digit", minute: "2-digit" })}`));
    const locationRow = element("li");
    locationRow.append(element("span", "", "⌖"), element("span", "", event.location));
    meta.append(dateRow, locationRow);
    body.append(meta);

    const footer = element("div", "card-footer");
    const places = element("span", `places${event.available_places === 0 ? " places-full" : ""}`,
      event.available_places === 0 ? "Volgeboekt" : `${event.available_places} ${event.available_places === 1 ? "plek" : "plekken"} vrij`);
    const detail = element("button", "text-button", "Bekijk activiteit →");
    detail.type = "button";
    detail.addEventListener("click", () => {
      history.pushState({ activityId: event.id }, "", `/?activiteit=${event.id}`);
      openEvent(event.id);
    });
    footer.append(places, detail);
    body.append(footer);
    card.append(body);
    eventList.append(card);
  });
}

function makeMeta(event) {
  const meta = element("ul", "event-meta dialog-meta");
  [
    ["◷", `${formatDate(event.date_time)} · ${formatDate(event.date_time, { hour: "2-digit", minute: "2-digit" })} uur`],
    ["⌖", event.location],
    ["✳", event.status === "cancelled" ? "Geannuleerd" : `${event.available_places} ${event.available_places === 1 ? "plek" : "plekken"} beschikbaar`]
  ].forEach(([icon, text]) => {
    const row = element("li");
    row.append(element("span", "", icon), element("span", "", text));
    meta.append(row);
  });
  return meta;
}

async function openEvent(id) {
  dialogContent.replaceChildren(element("p", "form-message", "Activiteit laden…"));
  dialog.showModal();
  try {
    const event = await request(`/api/events/${id}`);
    dialogContent.replaceChildren();
    dialogContent.append(makeImage(event, "dialog-image"));
    const inner = element("div", "dialog-inner");
    const top = element("div", "dialog-top");
    top.append(element("span", "event-category", event.category_name));
    const close = element("button", "dialog-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Sluit details");
    close.addEventListener("click", () => dialog.close());
    top.append(close);
    const title = element("h2", "", event.title);
    title.id = "dialog-title";
    inner.append(top, title, makeMeta(event), element("p", "dialog-description", event.description));

    if (event.status === "cancelled") {
      inner.append(element("p", "cancelled-notice", "Deze activiteit is geannuleerd en aanmelden is niet meer mogelijk."));
    } else if (event.available_places === 0) {
      inner.append(element("p", "cancelled-notice", "Deze activiteit is volgeboekt. Er zijn geen plaatsen meer beschikbaar."));
    } else if (new Date(event.date_time) <= new Date()) {
      inner.append(element("p", "cancelled-notice", "Deze activiteit heeft al plaatsgevonden."));
    } else {
      inner.append(makeBookingForm(event));
    }
    dialogContent.append(inner);
  } catch (error) {
    dialogContent.replaceChildren(element("p", "form-message", error.message));
  }
}

function makeBookingForm(event) {
  const form = element("form", "booking-form");
  form.append(element("h3", "", "Reserveer je plek"));
  const nameLabel = element("label", "form-field", "Je naam");
  const name = element("input");
  name.name = "name";
  name.autocomplete = "name";
  name.required = true;
  name.maxLength = 120;
  nameLabel.append(name);

  const emailLabel = element("label", "form-field", "Je e-mailadres");
  const email = element("input");
  email.type = "email";
  email.name = "email";
  email.autocomplete = "email";
  email.required = true;
  email.maxLength = 254;
  emailLabel.append(email);

  const message = element("p", "form-message");
  message.setAttribute("role", "status");
  const submit = element("button", "button", "Meld mij aan");
  submit.type = "submit";
  form.append(nameLabel, emailLabel, message, submit);

  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    message.classList.remove("success");
    message.textContent = "Je aanmelding wordt verwerkt…";
    try {
      await request("/api/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: event.id, name: name.value, email: email.value })
      });
      message.classList.add("success");
      message.textContent = `Gelukt, ${name.value.trim()}! Je aanmelding is bevestigd.`;
      form.replaceChildren(element("h3", "", "Je bent aangemeld!"), message);
      await loadEvents();
    } catch (error) {
      message.textContent = error.message;
      submit.disabled = false;
    }
  });
  return form;
}

async function loadEvents() {
  events = await request("/api/events");
  showEvents();
}

async function initialize() {
  try {
    const [categories, loadedEvents] = await Promise.all([request("/api/categories"), request("/api/events")]);
    events = loadedEvents;
    categories.forEach((category) => {
      const option = element("option", "", category.name);
      option.value = category.id;
      categorySelect.append(option);
    });
    showEvents();
  } catch (error) {
    listStatus.textContent = error.message;
  }
}

document.querySelector("#filters").addEventListener("submit", (event) => event.preventDefault());
searchInput.addEventListener("input", showEvents);
categorySelect.addEventListener("change", showEvents);
document.querySelector("#clear-filters").addEventListener("click", () => {
  searchInput.value = "";
  categorySelect.value = "";
  showEvents();
  searchInput.focus();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("close", () => {
  if (new URLSearchParams(location.search).has("activiteit")) {
    history.replaceState({}, "", "/");
  }
});
window.addEventListener("popstate", () => {
  const eventId = new URLSearchParams(location.search).get("activiteit");
  if (eventId && /^\d+$/.test(eventId)) openEvent(Number(eventId));
  else if (dialog.open) dialog.close();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dialog.open) dialog.close();
});

initialize().then(() => {
  const eventId = new URLSearchParams(location.search).get("activiteit");
  if (eventId && /^\d+$/.test(eventId)) openEvent(Number(eventId));
});
