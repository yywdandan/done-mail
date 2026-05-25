import { createApp, h } from 'vue';
import { createRouter, createWebHistory, RouterView } from 'vue-router';
import McIcon from './components/McIcon.vue';
import './public.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/mail/:token', name: 'shared-mail', component: () => import('./views/SharedMail.vue') },
    { path: '/account/:token', name: 'shared-account', component: () => import('./views/SharedAccount.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/mail/invalid' }
  ]
});

const app = createApp({ render: () => h(RouterView) });
app.component('McIcon', McIcon);
app.use(router);
app.mount('#app');
