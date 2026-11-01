document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('ringLoginForm');
  const credentialsFields = document.getElementById('credentialsFields');
  const mfaFields = document.getElementById('mfaFields');
  const mfaPrompt = document.getElementById('mfaPrompt');
  const mfaCode = document.getElementById('mfaCode');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const submitButton = document.getElementById('submitLogin');
  const errorBox = document.getElementById('loginError');
  let requiresMfa = false;

  try {
    const response = await fetch('/auth/ring/status');
    const status = await response.json();
    if (status.authenticated) {
      window.location.replace('/');
    }
  } catch {
    showError('Could not check the login status. Refresh the page to try again.');
  }

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
        window.location.replace('/');
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
});
