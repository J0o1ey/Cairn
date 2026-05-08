import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'list',
    component: () => import('@/views/ProjectListView.vue'),
  },
  {
    path: '/projects/:id',
    name: 'graph',
    component: () => import('@/views/GraphView.vue'),
    props: true,
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
