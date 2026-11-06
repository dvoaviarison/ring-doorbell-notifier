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
    const response = await fetch(`/events?day=${encodeURIComponent(selectedEventDay)}`);
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

let selectedEventDay = new Date().toISOString().slice(0, 10);
let eventFetchId = 0;
let pushRegistration;
let pushSubscription;
let pushPublicKey;
let pushServerConfigured = false;

function updateEventDayNavigation() {
  const dayLabel = document.getElementById('eventDayLabel');
  const today = new Date().toISOString().slice(0, 10);
  const date = new Date(`${selectedEventDay}T00:00:00.000Z`);
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeZone: 'UTC'
  }).format(date);
  dayLabel.textContent = selectedEventDay === today ? `Today · ${formattedDate}` : formattedDate;
  document.getElementById('nextEventDayBtn').disabled = selectedEventDay >= today;
}

function changeEventDay(offset) {
  const date = new Date(`${selectedEventDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  const nextDay = date.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (nextDay > today) return;
  selectedEventDay = nextDay;
  fetchEvents();
}

function renderEvents(feed, events) {
  feed.textContent = '';
  if (events.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'event-empty-state text-center text-muted py-5';
    emptyState.textContent = 'No video events for this day.';
    feed.appendChild(emptyState);
    return;
  }

  events.forEach((event) => {
    const card = document.createElement('article');
    card.className = 'event-card card mb-3';
    const body = document.createElement('div');
    body.className = 'card-body';

    const heading = document.createElement('div');
    heading.className = 'd-flex align-items-start justify-content-between gap-3 mb-2';
    const description = document.createElement('p');
    description.className = 'event-description mb-0';
    description.textContent = event.description || 'Camera event';
    const timestamp = document.createElement('time');
    timestamp.className = 'event-timestamp text-muted text-nowrap';

    const date = new Date(event.timestamp);
    if (!Number.isNaN(date.getTime())) {
      timestamp.dateTime = date.toISOString();
      timestamp.textContent = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
      }).format(date) + ' UTC';
    } else {
      timestamp.textContent = 'Time unavailable';
    }

    heading.append(description, timestamp);
    body.appendChild(heading);

    const videoUrl = getMegaVideoUrl(event.megaLink);
    if (videoUrl) {
      const link = document.createElement('a');
      link.className = 'event-video-link';
      link.href = videoUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '▶  Watch video on MEGA';
      body.appendChild(link);
    } else {
      const unavailable = document.createElement('span');
      unavailable.className = 'text-muted small';
      unavailable.textContent = 'Video link unavailable';
      body.appendChild(unavailable);
    }

    card.appendChild(body);
    feed.appendChild(card);
  });
}

function getMegaVideoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.hash === '#settings') {
    bootstrap.Tab.getOrCreateInstance(document.getElementById('settings-tab')).show();
  }

  fetchEvents();

  document.getElementById('refreshEventsBtn').addEventListener('click', fetchEvents);
  document.getElementById('previousEventDayBtn').addEventListener('click', () => changeEventDay(-1));
  document.getElementById('nextEventDayBtn').addEventListener('click', () => changeEventDay(1));
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