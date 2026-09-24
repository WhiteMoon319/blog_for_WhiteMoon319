// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 写作区入口：与后台共用组件与 API 客户端，但有自己的壳与路由表。

import { createApp } from 'vue';
import WriteApp from './WriteApp.vue';
import router from './router';
import '../assets/admin.css';

createApp(WriteApp).use(router).mount('#app');
