const AUTH_TOKEN_KEY = "tetris_auth_token";
const AUTH_USER_KEY = "tetris_auth_user";
const REMEMBER_CREDENTIALS_KEY = "tetris_remember_credentials";

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function getAuthUser() {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getRememberedCredentials() {
  const raw = localStorage.getItem(REMEMBER_CREDENTIALS_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.login === "string" && typeof o.password === "string") {
      return { login: o.login, password: o.password };
    }
    return null;
  } catch {
    return null;
  }
}

function setRememberedCredentials(login, password) {
  localStorage.setItem(
    REMEMBER_CREDENTIALS_KEY,
    JSON.stringify({ login: login.trim(), password }),
  );
}

function clearRememberedCredentials() {
  localStorage.removeItem(REMEMBER_CREDENTIALS_KEY);
}

function attachPasswordToggle(input, toggleBtn) {
  if (!input || !toggleBtn) return;
  const showLabel = "Show";
  const hideLabel = "Hide";
  toggleBtn.type = "button";
  toggleBtn.textContent = showLabel;
  toggleBtn.setAttribute("aria-label", "Show password");
  toggleBtn.setAttribute("aria-pressed", "false");

  toggleBtn.addEventListener("click", () => {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    toggleBtn.textContent = hidden ? hideLabel : showLabel;
    toggleBtn.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
    toggleBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
  });
}

async function tryLoginWithRememberedCredentials() {
  if (getAuthToken()) return false;
  const cred = getRememberedCredentials();
  if (!cred?.login || !cred?.password) return false;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: cred.login, password: cred.password }),
    });
    if (!res.ok) {
      clearRememberedCredentials();
      return false;
    }
    const data = await res.json();
    if (!data.token || !data.user) {
      clearRememberedCredentials();
      return false;
    }
    setAuthSession(data.token, data.user);
    return true;
  } catch {
    return false;
  }
}
