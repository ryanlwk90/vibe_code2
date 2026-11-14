<script setup>
import { onMounted, ref } from 'vue'
import { api } from './api.js'

const account = ref(null)
const view = ref('products')
const products = ref([])
const users = ref([])
const orders = ref([])
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const views = [
  { id: 'products', label: 'Products' },
  { id: 'users', label: 'Users' },
  { id: 'orders', label: 'Orders' },
]

async function refreshSession() {
  try {
    const { body } = await api('/api/auth/me')
    account.value = body.account
    return true
  } catch {
    account.value = null
    return false
  }
}

async function loadProducts() {
  const { body } = await api('/api/get_products')
  products.value = body
}

async function loadUsers() {
  const { body } = await api('/api/get_users')
  users.value = body
}

async function loadOrders() {
  const { body } = await api('/api/get_orders')
  orders.value = body
}

async function loadCurrentView() {
  if (view.value === 'products') await loadProducts()
  else if (view.value === 'users') await loadUsers()
  else await loadOrders()
}

async function switchView(id) {
  if (view.value === id) return
  view.value = id
  error.value = ''
  loading.value = true
  try {
    await loadCurrentView()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function refreshData() {
  error.value = ''
  loading.value = true
  try {
    await loadCurrentView()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function formatOrderDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    const { body } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: email.value.trim(),
        password: password.value,
      }),
    })
    account.value = body.account
    password.value = ''
    view.value = 'products'
    await loadProducts()
  } catch (err) {
    error.value = err.message
    products.value = []
    users.value = []
    orders.value = []
  } finally {
    loading.value = false
  }
}

async function handleLogout() {
  error.value = ''
  loading.value = true
  try {
    await api('/api/auth/logout', { method: 'POST' })
  } catch {
    /* cookie cleared server-side when session existed */
  } finally {
    account.value = null
    products.value = []
    users.value = []
    orders.value = []
    view.value = 'products'
    loading.value = false
  }
}

onMounted(async () => {
  if (await refreshSession()) {
    try {
      await loadProducts()
    } catch (err) {
      error.value = err.message
    }
  }
})
</script>

<template>
  <main class="page">
    <header>
      <h1>Lesson 4B Store</h1>
      <p v-if="account" class="meta">
        Signed in as <strong>{{ account.name }}</strong> ({{ account.role }})
      </p>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section v-if="!account" class="card">
      <h2>Log in</h2>
      <form @submit.prevent="handleLogin">
        <label>
          Email
          <input v-model="email" type="email" autocomplete="username" required />
        </label>
        <label>
          Password
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>
        <button type="submit" :disabled="loading">
          {{ loading ? 'Logging in…' : 'Log in' }}
        </button>
      </form>
    </section>

    <section v-else>
      <nav class="tabs" role="tablist" aria-label="Data views">
        <button
          v-for="tab in views"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="view === tab.id"
          class="tab"
          :class="{ active: view === tab.id }"
          :disabled="loading"
          @click="switchView(tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div class="toolbar">
        <button type="button" :disabled="loading" @click="handleLogout">Log out</button>
        <button type="button" :disabled="loading" @click="refreshData">
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
      </div>

      <template v-if="view === 'products'">
        <div v-if="!loading && products.length === 0" class="card muted">No products yet.</div>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Description</th>
              <th>Price</th>
              <th>Qty</th>
              <th>Image</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in products" :key="p.pid">
              <td>{{ p.pid }}</td>
              <td>{{ p.pname }}</td>
              <td class="desc">{{ p.description || '—' }}</td>
              <td>{{ p.price }}</td>
              <td>{{ p.qty }}</td>
              <td>
                <img
                  v-if="p.image_updated_at"
                  :src="`/api/products/${p.pid}/image?v=${encodeURIComponent(p.image_updated_at)}`"
                  alt=""
                  width="48"
                  height="48"
                />
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-else-if="view === 'users'">
        <div v-if="!loading && users.length === 0" class="card muted">No users yet.</div>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.uid">
              <td>{{ u.uid }}</td>
              <td>{{ u.uname }}</td>
              <td>{{ u.email }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-else>
        <div v-if="!loading && orders.length === 0" class="card muted">No orders yet.</div>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>User</th>
              <th>Product</th>
              <th>Order date</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in orders" :key="o.oid">
              <td>{{ o.oid }}</td>
              <td>{{ o.uname }} <span class="sub">(uid {{ o.uid }})</span></td>
              <td>{{ o.pname }} <span class="sub">(pid {{ o.pid }})</span></td>
              <td>{{ formatOrderDate(o.order_date) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 56rem;
  margin: 2rem auto;
  padding: 0 1rem;
  line-height: 1.5;
}

header h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}

.meta {
  margin: 0 0 1rem;
  color: #444;
}

.card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 1rem 1.25rem;
}

.muted {
  color: #666;
}

form {
  display: grid;
  gap: 0.75rem;
  max-width: 20rem;
}

label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.9rem;
}

input {
  padding: 0.45rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 6px;
}

button {
  padding: 0.45rem 0.9rem;
  border: 1px solid #333;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.tab {
  border-color: #aaa;
  background: #f8f8f8;
}

.tab.active {
  background: #333;
  color: #fff;
  border-color: #333;
}

.toolbar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.error {
  color: #a40000;
  background: #ffecec;
  border: 1px solid #f5c2c2;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.data-table th,
.data-table td {
  border: 1px solid #ddd;
  padding: 0.4rem 0.6rem;
  text-align: left;
  vertical-align: top;
}

.data-table th {
  background: #f6f6f6;
}

.data-table img {
  object-fit: cover;
  display: block;
  background: #eee;
}

.desc {
  max-width: 14rem;
  font-size: 0.9rem;
  color: #444;
}

.sub {
  font-size: 0.85rem;
  color: #666;
}
</style>