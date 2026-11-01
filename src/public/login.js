document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('ringLoginForm');
  if (!form) return;

  const credentialsFields = document.getElementById('ringCredentialsFields');
  const mfaFields = document.getElementById('ringMfaFields');
  const mfaPrompt = document.getElementById('ringMfaPrompt');
  const mfaCode = document.getElementById('ringMfaCode');
  const email = document.getElementById('ringEmail');
  const password = document.getElementById('ringPassword');
  const submitButton = document.getElementById('submitRingLogin');
  const errorBox = document.getElementById('ringLoginError');
  const connectionStatus = document.getElementById('ringConnectionStatus');
  const showLoginButton = document.getElementById('showRingLoginBtn');
  let requiresMfa = false;

  try {
    const response = await fetch('/auth/ring/status');
    const status = await response.json();
    updateConnectionStatus(status.authenticated);
  } catch {
    connectionStatus.textContent = 'Could not check the Ring connection status.';
  }

  showLoginButton.addEventListener('click', () => {
    form.classList.toggle('d-none');
    showLoginButton.textContent = form.classList.contains('d-none')
      ? 'Connect Ring account'
      : 'Hide Ring account form';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError();
    submitButton.disabled = true;
    submitButton.textContent = requiresMfa ? 'Verifying...' : 'Signing in...';

    const url = requiresMfa ? '/auth/ring/mfa' : '/auth/ring/login';
    const payload = requiresMfa
      ? { code: mfaCode.value }
      : {
          email: email.value,
          password: password.value
        };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.authenticated) {
        updateConnectionStatus(true);
        form.reset();
        form.classList.add('d-none');
        showLoginButton.textContent = 'Reconnect Ring account';
        requiresMfa = false;
        credentialsFields.classList.remove('d-none');
        mfaFields.classList.add('d-none');
        email.required = true;
        password.required = true;
        mfaCode.required = false;
        window.refreshCameras?.();
        return;
      }
      if (result.requiresMfa) {
        requiresMfa = true;
        credentialsFields.classList.add('d-none');
        email.required = false;
        password.required = false;
        password.value = '';
        mfaFields.classList.remove('d-none');
        mfaCode.required = true;
        mfaPrompt.textContent = result.prompt || 'Enter the verification code sent by Ring.';
        mfaCode.focus();
        if (result.error) showError(result.error);
        return;
      }
      showError(result.error || 'Sign in failed. Try again.');
    } catch {
      showError('Could not contact the server. Check your connection and try again.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = requiresMfa ? 'Verify code' : 'Sign in';
    }
  });

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('d-none');
  }

  function hideError() {
    errorBox.textContent = '';
    errorBox.classList.add('d-none');
  }

  function updateConnectionStatus(connected) {
    connectionStatus.textContent = connected
      ? 'Connected to Ring. Your saved refresh token is active.'
      : 'Not connected to Ring. Connect your account to enable camera features.';
    connectionStatus.classList.toggle('text-success', connected);
    connectionStatus.classList.toggle('text-danger', !connected);
    showLoginButton.textContent = connected ? 'Reconnect Ring account' : 'Connect Ring account';
  }
});
