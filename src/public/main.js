async function fetchCameras() {
  try {
    const res = await fetch('/cameras');
    const cameras = res.ok ? await res.json() : [];
    const dropdown = document.getElementById('cameraDropdown');
    dropdown.querySelectorAll('option:not(:disabled)').forEach(option => option.remove());
    if (!Array.isArray(cameras)) {
      throw new Error('Ring is not connected. Connect your Ring account in Settings.');
    }
    cameras.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      dropdown.appendChild(option);
    });
    if (cameras.length === 0) {
      document.getElementById('result-capture').innerText = 'No Ring cameras available. Check the Ring connection in Settings.';
    } else {
      document.getElementById('result-capture').innerText = '';
    }
  } catch (err) {
    document.getElementById('result-capture').innerText = 'Error loading cameras: ' + err.message;
  }
}

window.refreshCameras = fetchCameras;

function toggleButton() {
  const cameraName = document.getElementById('cameraDropdown').value;
  document.getElementById('captureBtn').disabled = !cameraName;
}

async function callCapture() {
  const cameraName = document.getElementById('cameraDropdown').value;
  if (!cameraName) {
    document.getElementById('result-capture').innerText = 'Please select a camera.';
    return;
  }
  document.getElementById('result-capture').innerText = 'Starting capture...';
  try {
    const res = await fetch('/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameraName })
    });
    const text = await res.text();
    document.getElementById('result-capture').innerText = res.ok
      ? text
      : `Could not start capture: ${text}`;
  } catch (err) {
    document.getElementById('result-capture').innerText = 'Could not contact the server: ' + err.message;
  }
}

async function fetchEvents() {
  const feed = document.getElementById('eventFeed');
  const requestId = ++eventFetchId;
  feed.textContent = '';
  const loadingMessage = document.createElement('p');
  loadingMessage.className = 'text-muted';
  loadingMessage.textContent = 'Loading events...';
  feed.appendChild(loadingMessage);
  updateEventDayNavigation();

  try {
    const { start, end } = getLocalDayBounds(selectedEventDay);
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    const response = await fetch(`/events?${params}`);
    if (response.redirected) {
      throw new Error('Connect your Ring account in Settings to view events.');
    }
    if (!response.ok) {
      throw new Error(response.status === 401
        ? 'Connect your Ring account in Settings to view events.'
        : 'Could not load video events.');
    }

    const events = await response.json();
    if (!Array.isArray(events)) {
      throw new Error('The server returned an invalid events list.');
    }
    if (requestId !== eventFetchId) return;
    renderEvents(feed, events);
  } catch (error) {
    if (requestId !== eventFetchId) return;
    feed.textContent = '';
    const message = document.createElement('p');
    message.className = 'text-danger';
    message.textContent = error.message || 'Could not load video events.';
    feed.appendChild(message);
  }
}

let selectedEventDay = getLocalDateString(new Date());
let eventFetchId = 0;
let currentEvents = [];
let selectedEventIndex = -1;
let pushRegistration;
let pushSubscription;
let pushPublicKey;
let pushServerConfigured = false;

function updateEventDayNavigation() {
  const dayLabel = document.getElementById('eventDayLabel');
  const today = getLocalDateString(new Date());
  const date = parseLocalDate(selectedEventDay);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full'
  }).format(date);
  dayLabel.textContent = selectedEventDay === today
    ? 'Today'
    : selectedEventDay === getLocalDateString(yesterday)
      ? 'Yesterday'
      : formattedDate;
  const datePicker = document.getElementById('eventDatePicker');
  datePicker.value = selectedEventDay;
  datePicker.max = today;
  document.getElementById('nextEventDayBtn').disabled = selectedEventDay >= today;
}

function changeEventDay(offset) {
  const date = parseLocalDate(selectedEventDay);
  date.setDate(date.getDate() + offset);
  const nextDay = getLocalDateString(date);
  const today = getLocalDateString(new Date());
  if (nextDay > today) return;
  selectedEventDay = nextDay;
  fetchEvents();
}

function renderEvents(feed, events) {
  feed.textContent = '';
  feed.classList.toggle('is-empty', events.length === 0);
  currentEvents = events;
  selectedEventIndex = events.length ? 0 : -1;
  renderSelectedEvent();

  if (events.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'event-empty-state';
    const icon = document.createElement('span');
    icon.className = 'event-empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✓';
    const title = document.createElement('h3');
    title.className = 'h6 mb-1';
    title.textContent = 'No events for this day';
    const message = document.createElement('p');
    message.className = 'mb-0';
    message.textContent = 'Camera recordings will appear here when an event is detected.';
    emptyState.append(icon, title, message);
    feed.appendChild(emptyState);
    return;
  }

  events.forEach((event, index) => {
    const item = document.createElement('article');
    item.className = 'timeline-item';
    item.classList.toggle('is-selected', index === selectedEventIndex);

    const time = document.createElement('time');
    time.className = 'timeline-time';
    const eventDate = new Date(event.timestamp);
    if (!Number.isNaN(eventDate.getTime())) {
      time.dateTime = eventDate.toISOString();
      time.textContent = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(eventDate);
    } else {
      time.textContent = '--:--:--';
    }

    const marker = document.createElement('span');
    marker.className = 'timeline-marker';
    marker.setAttribute('aria-hidden', 'true');

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'timeline-event';
    selectButton.setAttribute('aria-pressed', String(index === selectedEventIndex));
    selectButton.addEventListener('click', () => {
      selectedEventIndex = index;
      feed.querySelectorAll('.timeline-item').forEach((timelineItem, itemIndex) => {
        timelineItem.classList.toggle('is-selected', itemIndex === index);
        timelineItem.querySelector('.timeline-event')
          .setAttribute('aria-pressed', String(itemIndex === index));
      });
      renderSelectedEvent();
      document.querySelector('.event-viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const description = document.createElement('span');
    description.className = 'timeline-description';
    description.textContent = getEventDisplayDescription(event.description);

    selectButton.classList.add('has-preview');
    const preview = document.createElement('span');
    preview.className = 'timeline-preview';
    preview.setAttribute('aria-hidden', 'true');

    if (typeof event.thumbnailLink === 'string' &&
        event.thumbnailLink &&
        /^[a-f\d]{24}$/i.test(event.id ?? '')) {
      const thumbnail = document.createElement('img');
      thumbnail.className = 'timeline-thumbnail';
      thumbnail.alt = '';
      thumbnail.loading = 'eager';
      thumbnail.decoding = 'async';
      thumbnail.src = `/events/${encodeURIComponent(event.id)}/thumbnail`;
      thumbnail.addEventListener('error', () => thumbnail.remove(), { once: true });
      preview.appendChild(thumbnail);
    }

    selectButton.append(preview, description);
    item.append(time, marker, selectButton);
    feed.appendChild(item);
  });
}

function renderSelectedEvent() {
  const playerStage = document.getElementById('selectedEventPlayer');
  const caption = document.getElementById('selectedEventCaption');
  playerStage.textContent = '';
  caption.textContent = '';

  const event = currentEvents[selectedEventIndex];
  if (!event) {
    const placeholder = document.createElement('div');
    placeholder.className = 'event-player-placeholder';
    const icon = document.createElement('span');
    icon.className = 'event-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '▶';
    const message = document.createElement('span');
    message.textContent = 'No recording selected';
    const hint = document.createElement('span');
    hint.className = 'text-muted';
    hint.textContent = 'Choose another date to browse recordings.';
    placeholder.append(icon, message, hint);
    playerStage.appendChild(placeholder);
    return;
  }

  if (typeof event.id === 'string' && /^[a-f\d]{24}$/i.test(event.id)) {
    const player = document.createElement('video');
    player.className = 'event-video-player';
    player.src = `/events/${encodeURIComponent(event.id)}/video`;
    if (typeof event.thumbnailLink === 'string' && event.thumbnailLink) {
      player.poster = `/events/${encodeURIComponent(event.id)}/thumbnail`;
    }
    player.title = `Video: ${getEventDisplayDescription(event.description)}`;
    player.controls = true;
    player.playsInline = true;
    player.preload = 'metadata';
    playerStage.appendChild(player);
  } else {
    const unavailable = document.createElement('div');
    unavailable.className = 'event-player-placeholder';
    unavailable.textContent = 'This event does not have a playable video.';
    playerStage.appendChild(unavailable);
  }

  const eventTime = new Date(event.timestamp);
  const eventMeta = document.createElement('div');
  eventMeta.className = 'selected-event-meta';
  const description = document.createElement('p');
  description.className = 'event-description mb-1';
  description.textContent = getEventDisplayDescription(event.description);
  const timestamp = document.createElement('time');
  timestamp.className = 'event-timestamp text-muted';
  if (!Number.isNaN(eventTime.getTime())) {
    timestamp.dateTime = eventTime.toISOString();
    timestamp.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(eventTime);
  } else {
    timestamp.textContent = 'Time unavailable';
  }
  eventMeta.append(description, timestamp);
  caption.appendChild(eventMeta);
}

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(day) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

function getLocalDayBounds(day) {
  const start = parseLocalDate(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function getEventDisplayDescription(description) {
  if (typeof description !== 'string' || !description.trim()) {
    return 'Camera event';
  }
  return description.replace(/^\s*@channel\s*:?\s*/i, '');
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.hash === '#settings') {
    bootstrap.Tab.getOrCreateInstance(document.getElementById('settings-tab')).show();
  }

  fetchEvents();

  document.getElementById('refreshEventsBtn').addEventListener('click', fetchEvents);
  document.getElementById('previousEventDayBtn').addEventListener('click', () => changeEventDay(-1));
  document.getElementById('nextEventDayBtn').addEventListener('click', () => changeEventDay(1));
  document.getElementById('eventDatePicker').addEventListener('change', (event) => {
    const selectedDay = event.currentTarget.value;
    const today = getLocalDateString(new Date());
    if (selectedDay && selectedDay <= today) {
      selectedEventDay = selectedDay;
      fetchEvents();
    }
  });
  document.getElementById('home-tab').addEventListener('shown.bs.tab', fetchEvents);
  document.getElementById('settings-tab').addEventListener('shown.bs.tab', fetchCameras);
  initializePushNotifications();

  // Pre-populate prompt textbox from /env?name=APP_AI_USER_PROMPT
  fetch('/env?name=APP_AI_USER_PROMPT')
    .then(res => res.json())
    .then(data => {
      document.getElementById('userPromptTextbox').value = data.APP_AI_USER_PROMPT || '';
    });

    async function initializePushNotifications() {
      const button = document.getElementById('togglePushNotificationsBtn');
      const status = document.getElementById('pushNotificationStatus');
      button.addEventListener('click', togglePushNotifications);

      if (!window.isSecureContext || !('serviceWorker' in navigator) ||
          !('PushManager' in window) || !('Notification' in window)) {
        status.textContent = 'Push notifications require a supported browser and a secure HTTPS connection.';
        return;
      }

      try {
        const response = await fetch('/push/config');
        if (!response.ok || response.redirected) {
          throw new Error('Connect your Ring account in Settings to configure notifications.');
        }
        const config = await response.json();
        pushPublicKey = config.publicKey;
        pushServerConfigured = config.configured;
        pushRegistration = await navigator.serviceWorker.register('/service-worker.js');
        pushSubscription = await pushRegistration.pushManager.getSubscription();

        if (pushSubscription) {
          if (pushServerConfigured) {
            await savePushSubscription(pushSubscription);
            status.textContent = Notification.permission === 'granted'
              ? 'Push notifications are enabled on this browser.'
              : 'A push subscription exists, but browser permission is not enabled.';
          } else {
            status.textContent = 'A browser subscription exists, but push notifications are not configured on the server.';
          }
        } else if (!config.configured) {
          status.textContent = 'Push notifications are not configured on the server. Add the VAPID settings to enable them.';
        } else if (Notification.permission === 'denied') {
          status.textContent = 'Notifications are blocked by your browser. Allow them in browser settings to continue.';
        } else {
          status.textContent = 'Get notified when a new video event is recorded.';
        }

        button.textContent = pushSubscription ? 'Turn off notifications' : 'Enable push notifications';
        button.disabled = !pushSubscription && (!pushServerConfigured || !pushPublicKey);
      } catch (error) {
        status.textContent = error.message || 'Could not initialize push notifications.';
      }
    }

    async function togglePushNotifications() {
      const button = document.getElementById('togglePushNotificationsBtn');
      const status = document.getElementById('pushNotificationStatus');
      const isUnsubscribing = Boolean(pushSubscription);
      button.disabled = true;

      try {
        if (pushSubscription) {
          const response = await fetch('/push/subscriptions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: pushSubscription.endpoint })
          });
          if (!response.ok) throw new Error('Could not disable push notifications on the server.');
          await pushSubscription.unsubscribe();
          pushSubscription = null;
          status.textContent = 'Push notifications are turned off on this browser.';
          button.textContent = 'Enable push notifications';
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          status.textContent = permission === 'denied'
            ? 'Notifications are blocked by your browser. Allow them in browser settings to continue.'
            : 'Push notification permission was not granted.';
          return;
        }

        pushSubscription = await pushRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(pushPublicKey)
        });
        await savePushSubscription(pushSubscription);
        status.textContent = 'Push notifications are enabled on this browser.';
        button.textContent = 'Turn off notifications';
      } catch (error) {
        if (!isUnsubscribing && pushSubscription) {
          await pushSubscription.unsubscribe();
          pushSubscription = null;
        }
        status.textContent = error.message || 'Could not update push notification settings.';
      } finally {
        button.disabled = !pushSubscription && (!pushServerConfigured || !pushPublicKey);
      }
    }

    async function savePushSubscription(subscription) {
      const response = await fetch('/push/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      if (!response.ok || response.redirected) {
        throw new Error('Could not save this browser subscription. Check your connection and try again.');
      }
    }

    function decodeVapidPublicKey(base64UrlKey) {
      const padding = '='.repeat((4 - base64UrlKey.length % 4) % 4);
      const base64 = (base64UrlKey + padding).replace(/-/g, '+').replace(/_/g, '/');
      return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    }

  // Set prompt button handler
  document.getElementById('setPromptBtn').addEventListener('click', async () => {
    const userPrompt = document.getElementById('userPromptTextbox').value;
    document.getElementById('result-prompt').innerText = 'Updating...';
    try {
      const res = await fetch('/update-user-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt })
      });
      const text = await res.text();
      document.getElementById('result-prompt').innerText = text;
    } catch (err) {
      document.getElementById('result-prompt').innerText = 'Error: ' + err;
    }
  });

  // Health check button handler
  document.getElementById('getHealthBtn').addEventListener('click', async () => {
    document.getElementById('result-health').innerText = 'Checking...';
    try {
      const res = await fetch('/health');
      const text = await res.text();
      document.getElementById('result-health').innerText = text;
    } catch (err) {
      document.getElementById('result-health').innerText = 'Error: ' + err;
    }
  });
});