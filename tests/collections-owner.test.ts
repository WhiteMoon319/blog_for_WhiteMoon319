// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 文集作者化（迁移 0035）：归属人即署名，作者只能管理自建文集。

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUser,
  banUser,
  createCollection,
  createCollectionWithTags,
  countForeignPostsInCollection,
  listCollections,
  listCollectionOwners,
  getCollectionOwner,
  createPost,
  getUserById,
  addCollectionCollaborator,
  removeCollectionCollaborator,
  listCollectionCollaborators,
  isCollectionCollaborator,
  requestCollectionInvite,
  listCollectionInvites,
  listInvitesByUser,
  decideCollectionInvite,
  listCollectionWriteView,
} from '../src/lib/db/index.ts';
import { canManageCollection, canWriteIntoCollection } from '../src/lib/api/collection-access.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

async function mkUser(username: string, role: 'reader' | 'author' | 'admin' = 'author', displayName = username) {
  const u = await createUser(db, {
    username,
    email: `${username}@example.com`,
    password_hash: 'x',
    display_name: displayName,
    role,
  });
  assert.ok(u, `创建用户 ${username} 失败`);
  return u;
}

test('迁移 0035：collections.created_by 齐备且历史文集回填到管理员', async () => {
  const cols = await db.prepare(`SELECT name FROM pragma_table_info('collections')`).all<{ name: string }>();
  assert.ok(cols.results?.some((c) => c.name === 'created_by'), 'collections.created_by 应存在');
  assert.ok(cols.results?.some((c) => c.name === 'is_public'), 'collections.is_public 应存在');

  const collabTable = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collection_collaborators'`)
    .first<{ name: string }>();
  assert.ok(collabTable, 'collection_collaborators 表应存在');
  const inviteTable = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collection_invites'`)
    .first<{ name: string }>();
  assert.ok(inviteTable, 'collection_invites 表应存在');

  // 模拟迁移前的历史文集：没有归属人、is_public 为默认 0
  const legacy = await db
    .prepare(`INSERT INTO collections (title, slug) VALUES ('遗留集', 'legacy-col-0035') RETURNING id`)
    .first<{ id: number }>();
  assert.ok(legacy);
  const before = await db
    .prepare('SELECT created_by, is_public FROM collections WHERE id = ?')
    .bind(legacy!.id)
    .first<{ created_by: number | null; is_public: number }>();
  assert.equal(before?.created_by, null, '新建的历史文集中归属为空');

  // 与迁移 0035 内完全一致的回填语句
  await db
    .prepare(
      `UPDATE collections SET created_by = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)
        WHERE created_by IS NULL`,
    )
    .run();
  await db.prepare('UPDATE collections SET is_public = 1').run();
  const admin = await db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).first<{ id: number }>();
  assert.ok(admin, '迁移 0027 应已种下管理员');
  const after = await db
    .prepare('SELECT created_by, is_public FROM collections WHERE id = ?')
    .bind(legacy!.id)
    .first<{ created_by: number | null; is_public: number }>();
  assert.equal(after?.created_by, admin!.id, '历史文集应回填到管理员');
  assert.equal(after?.is_public, 1, '历史文集应一律回填为公用，避免切断既有协作');
});

test('文集归属：创建带归属人，"我的文集"只列自建', async () => {
  const a = await mkUser('col-author-a');
  const b = await mkUser('col-author-b');

  const mineA = await createCollection(db, { title: '甲集', slug: 'owner-a', created_by: a.id });
  const mineB = await createCollectionWithTags(db, { title: '乙集', slug: 'owner-b', created_by: b.id }, []);
  assert.ok(mineA && mineB);
  assert.equal((await db.prepare('SELECT created_by FROM collections WHERE id = ?').bind(mineA!.id).first<{ created_by: number }>())?.created_by, a.id, '归属人应落库');

  const all = await listCollections(db);
  const onlyA = await listCollections(db, { ownerId: a.id });
  assert.ok(all.length >= 2, '全量列表含全部文集');
  assert.deepEqual(onlyA.map((c) => c.id), [mineA!.id], 'ownerId 过滤只返回自建');
});

test('文集管理权：管理员全权，作者仅自建，读者不可', async () => {
  const a = await mkUser('col-owner-a', 'author');
  const b = await mkUser('col-owner-b', 'author');
  const admin = await mkUser('col-owner-admin', 'admin');
  const reader = await mkUser('col-owner-reader', 'reader');

  const col = await createCollection(db, { title: '权限集', slug: 'col-perm', created_by: a.id });
  assert.ok(col);
  assert.equal(canManageCollection(a, col!), true, '作者可管自建');
  assert.equal(canManageCollection(b, col!), false, '作者不可管他人文集');
  assert.equal(canManageCollection(admin, col!), true, '管理员全权');
  assert.equal(canManageCollection(reader, col!), false, '读者不可');

  const orphan = await createCollection(db, { title: '无主集', slug: 'col-orphan' });
  assert.equal(canManageCollection(a, orphan!), false, '无归属文集作者不可管');
  assert.equal(canManageCollection(admin, orphan!), true, '管理员可管无归属文集');
});

test('删除保护：统计文集内他人归属文章（含无归属历史文）', async () => {
  const a = await mkUser('col-del-a', 'author');
  const b = await mkUser('col-del-b', 'author');
  const col = await createCollection(db, { title: '删前检查', slug: 'col-del-check', created_by: a.id });
  assert.ok(col);

  const own = await createPost(db, { title: '自己的', slug: 'col-del-own', collection_id: col!.id, created_by: a.id });
  const other = await createPost(db, { title: '别人的', slug: 'col-del-other', collection_id: col!.id, created_by: b.id });
  const legacy = await createPost(db, { title: '无归属', slug: 'col-del-legacy', collection_id: col!.id });
  assert.ok(own && other && legacy);

  assert.equal(await countForeignPostsInCollection(db, col!.id, a.id), 2, '他人 + 无归属都算受限');
  assert.equal(await countForeignPostsInCollection(db, col!.id, b.id), 2, '换个人算也是 2（自己的那篇被排除）');

  // 移走他人文章后只剩自己的，守卫放行
  await db.prepare('UPDATE posts SET collection_id = NULL WHERE id IN (?, ?)').bind(other!.id, legacy!.id).run();
  assert.equal(await countForeignPostsInCollection(db, col!.id, a.id), 0, '只剩自己的文章即可删除');
});

test('文集写入权：公用/私有 × 归属人/协作者/管理员', async () => {
  const owner = await mkUser('cw-owner', 'author');
  const other = await mkUser('cw-other', 'author');
  const collab = await mkUser('cw-collab', 'author');
  const admin = await mkUser('cw-admin', 'admin');
  const reader = await mkUser('cw-reader', 'reader');

  const privateCol = await createCollection(db, { title: '私集', slug: 'cw-private', created_by: owner.id, is_public: 0 });
  const publicCol = await createCollection(db, { title: '公集', slug: 'cw-public', created_by: owner.id, is_public: 1 });
  assert.ok(privateCol && publicCol);

  assert.equal(await canWriteIntoCollection(db, owner, privateCol!), true, '归属人可写自建私有集');
  assert.equal(await canWriteIntoCollection(db, other, privateCol!), false, '无关作者不可写私有集');
  assert.equal(await canWriteIntoCollection(db, other, publicCol!), true, '公用文集任何作者可写');
  assert.equal(await canWriteIntoCollection(db, admin, privateCol!), true, '管理员全权');
  assert.equal(await canWriteIntoCollection(db, reader, publicCol!), false, '读者不可写');

  await addCollectionCollaborator(db, privateCol!.id, collab.id);
  assert.equal(await canWriteIntoCollection(db, collab, privateCol!), true, '协作者可写私有集');
  assert.equal(await isCollectionCollaborator(db, privateCol!.id, collab.id), true);

  const members = await listCollectionCollaborators(db, privateCol!.id);
  assert.deepEqual(members.map((m) => m.user_id), [collab.id], '成员列表应按拉入顺序返回');

  assert.equal(await removeCollectionCollaborator(db, privateCol!.id, collab.id), true);
  assert.equal(await canWriteIntoCollection(db, collab, privateCol!), false, '移除后立即失去写入权');
  assert.equal(await removeCollectionCollaborator(db, privateCol!.id, collab.id), false, '重复移除返回 false');
});

test('协作申请：申请 → 同意成为协作者 / 拒绝仍不可写', async () => {
  const owner = await mkUser('ci-owner', 'author');
  const asker = await mkUser('ci-asker', 'author');
  const col = await createCollection(db, { title: '申请集', slug: 'ci-col', created_by: owner.id, is_public: 0 });
  assert.ok(col);

  assert.equal(await requestCollectionInvite(db, col!.id, asker.id, '想投稿'), 'created');
  let pending = await listCollectionInvites(db, col!.id, 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].user_id, asker.id, '申请应带申请人信息');
  assert.equal(pending[0].message, '想投稿');

  // 重复申请幂等：仍只有一条 pending
  assert.equal(await requestCollectionInvite(db, col!.id, asker.id, '再问一次'), 'resubmitted');
  pending = await listCollectionInvites(db, col!.id, 'pending');
  assert.equal(pending.length, 1, '同一用户在同一文集只保留一条申请');
  assert.equal(pending[0].message, '再问一次', '重复申请应更新理由');

  // 拒绝：不进协作者，仍不可写；再申请会回到 pending
  const rejected = await decideCollectionInvite(db, pending[0].id, false);
  assert.equal(rejected?.status, 'rejected');
  assert.equal(await isCollectionCollaborator(db, col!.id, asker.id), false);
  assert.equal(await listCollectionInvites(db, col!.id, 'pending').then((r) => r.length), 0);
  assert.equal(await requestCollectionInvite(db, col!.id, asker.id, '再来'), 'resubmitted');

  // 同意：自动成为协作者并可写
  const again = await listCollectionInvites(db, col!.id, 'pending');
  const accepted = await decideCollectionInvite(db, again[0].id, true);
  assert.equal(accepted?.status, 'accepted');
  assert.equal(await isCollectionCollaborator(db, col!.id, asker.id), true);
  assert.equal(await canWriteIntoCollection(db, asker, col!), true);
  assert.equal(await requestCollectionInvite(db, col!.id, asker.id, '还能申请吗'), 'accepted', '已是协作者时告知已通过');

  const mine = await listInvitesByUser(db, asker.id);
  assert.equal(mine[0].status, 'accepted', '申请人可看到自己申请的状态');

  assert.equal(await decideCollectionInvite(db, 999999, true), null, '不存在的申请返回 null');
});

test('写作区文集视图：关系与申请状态一次取回', async () => {
  const owner = await mkUser('cv-owner', 'author');
  const stranger = await mkUser('cv-stranger', 'author');
  const collab = await mkUser('cv-collab', 'author');
  const admin = await mkUser('cv-admin', 'admin');

  const mine = await createCollection(db, { title: '我的集', slug: 'cv-mine', created_by: owner.id, is_public: 0 });
  const pub = await createCollection(db, { title: '公集', slug: 'cv-pub', created_by: admin.id, is_public: 1 });
  const hidden = await createCollection(db, { title: '别人的私集', slug: 'cv-hidden', created_by: admin.id, is_public: 0 });
  assert.ok(mine && pub && hidden);

  await addCollectionCollaborator(db, hidden!.id, collab.id);
  await requestCollectionInvite(db, hidden!.id, stranger.id, '');

  const ownerView = await listCollectionWriteView(db, owner);
  const byId = (rows: Awaited<ReturnType<typeof listCollectionWriteView>>, id: number) => rows.find((r) => r.id === id);
  assert.equal(byId(ownerView, mine!.id)?.relation, 'owner', '自建集关系为 owner');
  assert.equal(byId(ownerView, mine!.id)?.can_write, true);
  assert.equal(byId(ownerView, hidden!.id)?.relation, 'private', '他人私有集关系为 private');
  assert.equal(byId(ownerView, hidden!.id)?.can_write, false, '他人私有集不可写');

  const collabView = await listCollectionWriteView(db, collab);
  assert.equal(byId(collabView, hidden!.id)?.relation, 'collaborator', '协作者关系为 collaborator');
  assert.equal(byId(collabView, hidden!.id)?.can_write, true);
  assert.equal(byId(collabView, pub!.id)?.relation, 'public', '公用集关系为 public');

  const strangerView = await listCollectionWriteView(db, stranger);
  assert.equal(byId(strangerView, hidden!.id)?.can_write, false, '未通过的申请人仍不可写');
  assert.equal(byId(strangerView, hidden!.id)?.invite_status, 'pending', '视图应带出我的申请状态');

  const adminView = await listCollectionWriteView(db, admin);
  assert.equal(byId(adminView, mine!.id)?.can_write, true, '管理员对任何文集都可写（绕过校验）');
});

test('文集署名：批量取归属作者，封禁状态一并返回', async () => {
  const a = await mkUser('col-sign-a', 'author', '甲作者');
  const banned = await mkUser('col-sign-b', 'author', '乙作者');
  const colA = await createCollection(db, { title: '署名甲集', slug: 'col-sign-a', created_by: a.id });
  const colB = await createCollection(db, { title: '署名乙集', slug: 'col-sign-b', created_by: banned.id });
  const orphan = await createCollection(db, { title: '署名无主集', slug: 'col-sign-none' });
  assert.ok(colA && colB && orphan);
  await banUser(db, banned.id);

  const owners = await listCollectionOwners(db, [colA!.id, colB!.id, orphan!.id, 999999]);
  assert.equal(owners.get(colA!.id)?.display_name, '甲作者', '应按文集 id 命中归属作者');
  assert.equal(owners.get(colB!.id)?.status, 'banned', '封禁状态要带出，前台据此降级展示');
  assert.equal(owners.get(orphan!.id), undefined, '无归属文集不产生作者');

  const single = await getCollectionOwner(db, colA!.id);
  assert.equal(single?.username, 'col-sign-a');
  assert.equal(await getCollectionOwner(db, orphan!.id), null);

  // 归属被清空（用户删除时 ON DELETE SET NULL）后不再有作者
  await db.prepare('UPDATE collections SET created_by = NULL WHERE id = ?').bind(colA!.id).run();
  assert.equal(await getCollectionOwner(db, colA!.id), null);
  assert.ok(await getUserById(db, a.id), '清空文集归属不影响用户本身');
});
