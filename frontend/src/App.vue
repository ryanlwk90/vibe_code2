<script setup>
import { computed, onMounted, ref } from 'vue'
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

const productForm = ref(emptyProductForm())
const userForm = ref(emptyUserForm())
const orderForm = ref(emptyOrderForm())
const editingProductId = ref(null)
const editingUserId = ref(null)
const editingOrderId = ref(null)

const isAdmin = computed(() => account.value?.role === 'admin')

const views = [
  { id: 'products', label: 'Products' },
  { id: 'users', label: 'Users' },
  { id: 'orders', label: 'Orders' },
]

function emptyProductForm() {
  return { pname: '', description: '', price: '', qty: '' }
}

function emptyUserForm() {
  return { uname: '', email: '', password: '' }
}

function emptyOrderForm() {
  return { uid: '', pid: '', order_date: '' }
}

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

function resetForms() {
  productForm.value = emptyProductForm()
  userForm.value = emptyUserForm()
  orderForm.value = emptyOrderForm()
  editingProductId.value = null
  editingUserId.value = null
  editingOrderId.value = null
}

async function switchView(id) {
  if (view.value === id) return
  view.value = id
  error.value = ''
  resetForms()
  loading.value = true
  try {
    await loadCurrentView()
    if (id === 'orders' && isAdmin.value) {
      await Promise.all([loadUsers(), loadProducts()])
    }
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
    if (view.value === 'orders' && isAdmin.value) {
      await Promise.all([loadUsers(), loadProducts()])
    }
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

function toDatetimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function runAdminAction(fn) {
  error.value = ''
  loading.value = true
  try {
    await fn()
    await loadCurrentView()
    if (view.value === 'orders') await Promise.all([loadUsers(), loadProducts()])
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function startEditProduct(p) {
  editingProductId.value = p.pid
  productForm.value = {
    pname: p.pname,
    description: p.description || '',
    price: String(p.price),
    qty: String(p.qty),
  }
}

async function saveProduct() {
  const payload = {
    pname: productForm.value.pname.trim(),
    description: productForm.value.description,
    price: Number(productForm.value.price),
    qty: Number.parseInt(productForm.value.qty, 10),
  }
  await runAdminAction(async () => {
    if (editingProductId.value) {
      await api(`/api/update_product/${editingProductId.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    } else {
      await api('/api/add_product', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    }
    productForm.value = emptyProductForm()
    editingProductId.value = null
  })
}

async function deleteProduct(pid) {
  if (!globalThis.confirm('Delete this product?')) return
  await runAdminAction(async () => {
    await api(`/api/delete_product/${pid}`, { method: 'DELETE' })
    if (editingProductId.value === pid) {
      productForm.value = emptyProductForm()
      editingProductId.value = null
    }
  })
}

function startEditUser(u) {
  editingUserId.value = u.uid
  userForm.value = { uname: u.uname, email: u.email, password: '' }
}

async function saveUser() {
  const payload = {
    uname: userForm.value.uname.trim(),
    email: userForm.value.email.trim().toLowerCase(),
  }
  if (!editingUserId.value) {
    payload.password = userForm.value.password
  } else if (userForm.value.password) {
    payload.password = userForm.value.password
  }
  await runAdminAction(async () => {
    if (editingUserId.value) {
      await api(`/api/update_user/${editingUserId.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    } else {
      await api('/api/add_user', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    }
    userForm.value = emptyUserForm()
    editingUserId.value = null
  })
}

async function deleteUser(uid) {
  if (!globalThis.confirm('Delete this user?')) return
  await runAdminAction(async () => {
    await api(`/api/delete_user/${uid}`, { method: 'DELETE' })
    if (editingUserId.value === uid) {
      userForm.value = emptyUserForm()
      editingUserId.value = null
    }
  })
}

function startEditOrder(o) {
  editingOrderId.value = o.oid
  orderForm.value = {
    uid: String(o.uid),
    pid: String(o.pid),
    order_date: toDatetimeLocal(o.order_date),
  }
}

async function saveOrder() {
  const payload = {
    uid: Number.parseInt(orderForm.value.uid, 10),
    pid: Number.parseInt(orderForm.value.pid, 10),
  }
  if (orderForm.value.order_date) {
    payload.order_date = new Date(orderForm.value.order_date).toISOString()
  }
  await runAdminAction(async () => {
    if (editingOrderId.value) {
      await api(`/api/update_order/${editingOrderId.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    } else {
      await api('/api/add_order', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    }
    orderForm.value = emptyOrderForm()
    editingOrderId.value = null
  })
}

async function deleteOrder(oid) {
  if (!globalThis.confirm('Delete this order?')) return
  await runAdminAction(async () => {
    await api(`/api/delete_order/${oid}`, { method: 'DELETE' })
    if (editingOrderId.value === oid) {
      orderForm.value = emptyOrderForm()
      editingOrderId.value = null
    }
  })
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
    resetForms()
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
    resetForms()
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
        <div v-if="isAdmin" class="card form-card">
          <h2>{{ editingProductId ? 'Edit product' : 'New product' }}</h2>
          <form class="row-form" @submit.prevent="saveProduct">
            <label>
              Name
              <input v-model="productForm.pname" required />
            </label>
            <label class="wide">
              Description
              <input v-model="productForm.description" />
            </label>
            <label>
              Price
              <input v-model="productForm.price" type="number" min="0" step="0.01" required />
            </label>
            <label>
              Qty
              <input v-model="productForm.qty" type="number" min="0" step="1" required />
            </label>
            <div class="form-actions">
              <button type="submit" :disabled="loading">
                {{ editingProductId ? 'Update' : 'Create' }}
              </button>
              <button
                v-if="editingProductId"
                type="button"
                class="secondary"
                :disabled="loading"
                @click="productForm = emptyProductForm(); editingProductId = null"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>

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
              <th v-if="isAdmin">Actions</th>
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
              <td v-if="isAdmin" class="actions">
                <button type="button" class="secondary" :disabled="loading" @click="startEditProduct(p)">
                  Edit
                </button>
                <button type="button" class="danger" :disabled="loading" @click="deleteProduct(p.pid)">
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-else-if="view === 'users'">
        <div v-if="isAdmin" class="card form-card">
          <h2>{{ editingUserId ? 'Edit user' : 'New user' }}</h2>
          <form class="row-form" @submit.prevent="saveUser">
            <label>
              Name
              <input v-model="userForm.uname" required />
            </label>
            <label>
              Email
              <input v-model="userForm.email" type="email" required />
            </label>
            <label>
              Password
              <input
                v-model="userForm.password"
                type="password"
                :required="!editingUserId"
                :placeholder="editingUserId ? 'Leave blank to keep' : ''"
              />
            </label>
            <div class="form-actions">
              <button type="submit" :disabled="loading">
                {{ editingUserId ? 'Update' : 'Create' }}
              </button>
              <button
                v-if="editingUserId"
                type="button"
                class="secondary"
                :disabled="loading"
                @click="userForm = emptyUserForm(); editingUserId = null"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>

        <div v-if="!loading && users.length === 0" class="card muted">No users yet.</div>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th v-if="isAdmin">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.uid">
              <td>{{ u.uid }}</td>
              <td>{{ u.uname }}</td>
              <td>{{ u.email }}</td>
              <td v-if="isAdmin" class="actions">
                <button type="button" class="secondary" :disabled="loading" @click="startEditUser(u)">
                  Edit
                </button>
                <button type="button" class="danger" :disabled="loading" @click="deleteUser(u.uid)">
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-else>
        <div v-if="isAdmin" class="card form-card">
          <h2>{{ editingOrderId ? 'Edit order' : 'New order' }}</h2>
          <form class="row-form" @submit.prevent="saveOrder">
            <label>
              User
              <select v-model="orderForm.uid" required>
                <option disabled value="">Select user</option>
                <option v-for="u in users" :key="u.uid" :value="String(u.uid)">
                  {{ u.uname }} ({{ u.uid }})
                </option>
              </select>
            </label>
            <label>
              Product
              <select v-model="orderForm.pid" required>
                <option disabled value="">Select product</option>
                <option v-for="p in products" :key="p.pid" :value="String(p.pid)">
                  {{ p.pname }} ({{ p.pid }})
                </option>
              </select>
            </label>
            <label>
              Order date
              <input v-model="orderForm.order_date" type="datetime-local" />
              <span class="hint">Optional for new orders (server default: now)</span>
            </label>
            <div class="form-actions">
              <button type="submit" :disabled="loading">
                {{ editingOrderId ? 'Update' : 'Create' }}
              </button>
              <button
                v-if="editingOrderId"
                type="button"
                class="secondary"
                :disabled="loading"
                @click="orderForm = emptyOrderForm(); editingOrderId = null"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>

        <div v-if="!loading && orders.length === 0" class="card muted">No orders yet.</div>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>User</th>
              <th>Product</th>
              <th>Order date</th>
              <th v-if="isAdmin">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in orders" :key="o.oid">
              <td>{{ o.oid }}</td>
              <td>{{ o.uname }} <span class="sub">(uid {{ o.uid }})</span></td>
              <td>{{ o.pname }} <span class="sub">(pid {{ o.pid }})</span></td>
              <td>{{ formatOrderDate(o.order_date) }}</td>
              <td v-if="isAdmin" class="actions">
                <button type="button" class="secondary" :disabled="loading" @click="startEditOrder(o)">
                  Edit
                </button>
                <button type="button" class="danger" :disabled="loading" @click="deleteOrder(o.oid)">
                  Delete
                </button>
              </td>
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
  max-width: 64rem;
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

.form-card {
  margin-bottom: 1rem;
}

.form-card h2 {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
}

.muted {
  color: #666;
}

form {
  display: grid;
  gap: 0.75rem;
  max-width: 20rem;
}

.row-form {
  max-width: none;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  align-items: end;
}

label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.9rem;
}

label.wide {
  grid-column: span 2;
}

input,
select {
  padding: 0.45rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 6px;
}

.hint {
  font-size: 0.8rem;
  color: #666;
}

.form-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

button {
  padding: 0.45rem 0.9rem;
  border: 1px solid #333;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

button.secondary {
  border-color: #888;
}

button.danger {
  border-color: #a40000;
  color: #a40000;
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

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  white-space: nowrap;
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