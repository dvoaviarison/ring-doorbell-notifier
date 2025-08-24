// Fetch camera names from a new endpoint
async function fetchCameras() {
  try {
    const res = await fetch('/cameras');
    const cameras = await res.json();
    const dropdown = document.getElementById('cameraDropdown');
    cameras.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      dropdown.appendChild(option);
    });
  } catch (err) {
    document.getElementById('result-capture').innerText = 'Error loading cameras: ' + err;
  }
}

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
  document.getElementById('result-capture').innerText = 'Sending...';
  try {
    const res = await fetch('/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameraName })
    });
    const text = await res.text();
    document.getElementById('result-capture').innerText = text;
  } catch (err) {
    document.getElementById('result-capture').innerText = 'Error: ' + err;
  }
}

// Collapsible Prompt Card
document.addEventListener('DOMContentLoaded', () => {
  fetchCameras();

  // Pre-populate prompt textbox from /env?name=APP_AI_USER_PROMPT
  fetch('/env?name=APP_AI_USER_PROMPT')
    .then(res => res.json())
    .then(data => {
      document.getElementById('userPromptTextbox').value = data.APP_AI_USER_PROMPT || '';
    });

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