// client/admin/src/main.js — starts the admin panel: the global styles, the router, then App.vue
// Mounted only once the first page is known (see below). Used by: client/admin/index.html
import { createApp } from 'vue';
import './styles/base.css';
import App from './App.vue';
import router from './router/index.js';

// Mount once the first page is known. Before that, the router reports "/" as the page, so the
// sidebar would briefly show on the login page, and its requests (which need a login) sent the
// browser to the login page again, over and over.
const app = createApp(App).use(router);
router.isReady().then(() => app.mount('#app'));
