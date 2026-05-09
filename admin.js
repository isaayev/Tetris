const usersBody = document.getElementById("users-body");
const adminError = document.getElementById("admin-error");
const adminOk = document.getElementById("admin-ok");
const grantLoginInput = document.getElementById("grant-login");
const grantBtn = document.getElementById("grant-btn");

function showError(message) {
  adminError.textContent = message;
  adminError.classList.toggle("hidden", !message);
}

function showOk(message) {
  adminOk.textContent = message;
  adminOk.classList.toggle("hidden", !message);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchMe() {
  const res = await fetch("/api/me", { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to load session");
  return data.user;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function actionButton(label, action, className = "") {
  return `<button type="button" class="admin-btn ${className}" data-action="${action}">${label}</button>`;
}

function renderUsers(users) {
  if (!Array.isArray(users) || users.length === 0) {
    usersBody.innerHTML = '<tr><td colspan="7" class="muted-cell">No users found.</td></tr>';
    return;
  }

  usersBody.innerHTML = users
    .map((user) => {
      const id = Number(user.id);
      return `
        <tr data-user-id="${id}">
          <td>${id}</td>
          <td>${escapeHtml(user.username)}</td>
          <td>${escapeHtml(user.email)}</td>
          <td>${Number(user.bestScore || 0)}</td>
          <td>${user.isAdmin ? "Yes" : "No"}</td>
          <td>${user.isBlocked ? "Yes" : "No"}</td>
          <td class="admin-actions-cell">
            ${actionButton("Edit", "edit")}
            ${actionButton(user.isBlocked ? "Unblock" : "Block", "toggle-block", user.isBlocked ? "ok" : "warn")}
            ${actionButton(user.isAdmin ? "Remove Admin" : "Make Admin", "toggle-admin")}
            ${actionButton("Delete", "delete", "danger")}
          </td>
        </tr>
      `;
    })
    .join("");
}

async function loadUsers() {
  showError("");
  const data = await requestJson("/api/admin/users", { headers: authHeaders() });
  renderUsers(data.users || []);
}

async function patchUser(userId, payload) {
  await requestJson(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
}

async function deleteUser(userId) {
  await requestJson(`/api/admin/users/${userId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

async function grantAdmin(login) {
  await requestJson("/api/admin/grant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ login }),
  });
}

usersBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = event.target.closest("tr[data-user-id]");
  if (!row) return;

  const userId = Number(row.dataset.userId);
  if (!userId) return;
  const action = button.dataset.action;

  showError("");
  showOk("");

  try {
    if (action === "edit") {
      const currentUsername = row.children[1].textContent.trim();
      const currentEmail = row.children[2].textContent.trim();
      const nextUsername = prompt("New username (leave empty to keep current):", currentUsername);
      if (nextUsername === null) return;
      const nextEmail = prompt("New email (leave empty to keep current):", currentEmail);
      if (nextEmail === null) return;
      const payload = {};
      if (nextUsername.trim() && nextUsername.trim() !== currentUsername) payload.username = nextUsername.trim();
      if (nextEmail.trim() && nextEmail.trim() !== currentEmail) payload.email = nextEmail.trim();
      if (Object.keys(payload).length === 0) return;
      await patchUser(userId, payload);
      showOk("User updated.");
    } else if (action === "toggle-block") {
      const blocked = row.children[5].textContent.trim() === "Yes";
      await patchUser(userId, { isBlocked: !blocked });
      showOk(blocked ? "User unblocked." : "User blocked.");
    } else if (action === "toggle-admin") {
      const isAdmin = row.children[4].textContent.trim() === "Yes";
      await patchUser(userId, { isAdmin: !isAdmin });
      showOk(isAdmin ? "Admin removed." : "Admin granted.");
    } else if (action === "delete") {
      const username = row.children[1].textContent.trim();
      const confirmDelete = confirm(`Delete user "${username}"? This cannot be undone.`);
      if (!confirmDelete) return;
      await deleteUser(userId);
      showOk("User deleted.");
    }

    await loadUsers();
  } catch (error) {
    showError(error.message || "Operation failed");
  }
});

grantBtn.addEventListener("click", async () => {
  const login = grantLoginInput.value.trim();
  if (!login) {
    showError("Enter username or email first.");
    return;
  }
  showError("");
  showOk("");
  try {
    await grantAdmin(login);
    grantLoginInput.value = "";
    showOk("Admin granted successfully.");
    await loadUsers();
  } catch (error) {
    showError(error.message || "Grant failed");
  }
});

(async function initAdminPage() {
  try {
    if (!getAuthToken()) {
      window.location.href = "login.html";
      return;
    }
    const user = await fetchMe();
    if (!user?.isAdmin) {
      showError("Only admins can access this page.");
      usersBody.innerHTML = '<tr><td colspan="7" class="muted-cell">Admin access required.</td></tr>';
      return;
    }
    await loadUsers();
  } catch (error) {
    showError(error.message || "Failed to initialize admin panel.");
    usersBody.innerHTML = '<tr><td colspan="7" class="muted-cell">Could not load users.</td></tr>';
  }
})();
