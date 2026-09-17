-- ============================================================================
--  藏宝阁台账 · Supabase 建表脚本
--
--  用法：Supabase 控制台 → SQL Editor → 新建查询 → 整段粘贴 → Run
--  幂等，可重复执行。
--
--  两张表：roles / products。
--  区服（zone / sold_zone）是它们身上的文本字段，不单独建表 ——
--  区服从数据里自动汇总，不需要（也无法）手工维护。
--
--  安全模型：每行都有 owner 字段，默认填当前登录用户的 id；
--  RLS 策略限定「只能读写 owner = 自己」的数据，匿名（未登录）完全无权限。
-- ============================================================================

-- ---------------------------------------------------------------- 表结构

-- 角色（同时是「项目批次」：可整体转手 / 拆号变现 / 转服卖出）
create table if not exists public.roles (
  id              text primary key,
  owner           uuid default auth.uid(),
  zone            text          not null default '',        -- 买入时所在区服
  name            text          not null default '',
  level           integer,
  school          text          not null default '',
  purchase_price  numeric(14,2) not null default 0,   -- 买入价
  purchase_date   date,                               -- 买入日期
  transfer_fee    numeric(14,2) not null default 0,   -- 转服费
  other_cost      numeric(14,2) not null default 0,   -- 其他成本（点卡/代练等）
  status          text          not null default 'holding',  -- holding | sold
  is_shell        boolean       not null default false,      -- 是否已拆成空壳号
  listed          boolean       not null default false,      -- 是否已挂牌
  listed_price    numeric(14,2) not null default 0,   -- 挂牌价
  est_value       numeric(14,2),                      -- 手工估算市值（可空）
  sale_price      numeric(14,2) not null default 0,   -- 成交价
  sale_net        numeric(14,2),                      -- 实际到手（可空＝按规则自动算）
  sale_date       date,
  sold_zone       text          not null default '',  -- 成交时所在区服（转服后才与 zone 不同）
  note            text          not null default '',
  created_at      timestamptz   not null default now()
);

-- 商品（独立采购 或 从角色拆出 —— 用 role_id 区分）
create table if not exists public.products (
  id              text primary key,
  owner           uuid default auth.uid(),
  zone            text          not null default '',  -- 所在区服
  name            text          not null default '',
  category        text          not null default 'equipment',
  sub_category    text          not null default '',   -- 二级分类，非必填
  from_asset      boolean       not null default false, -- 固定资产流出
  role_id         text references public.roles(id) on delete set null,  -- 空 = 独立采购
  purchase_price  numeric(14,2) not null default 0,
  purchase_date   date,
  allocated_cost  numeric(14,2),                      -- 手工指定分摊成本（可空）
  est_value       numeric(14,2),                      -- 手工估算市值（可空）
  status          text          not null default 'holding',
  listed          boolean       not null default false,
  listed_price    numeric(14,2) not null default 0,
  sale_price      numeric(14,2) not null default 0,
  sale_net        numeric(14,2),
  sale_date       date,
  sold_zone       text          not null default '',
  note            text          not null default '',
  created_at      timestamptz   not null default now()
);

-- 自玩号 —— 固定资产的「容器」：常玩的号本身（哪怕是空号）也有购入成本。
-- 自己练起来的号，purchase_price 填 0 即可。
-- sold 系列字段：卖掉后**保留记录**只做标记，不再算「还在手上」，可以撤销。
create table if not exists public.chars (
  id              text primary key,
  owner           uuid default auth.uid(),
  zone            text          not null default '',  -- 号所在区
  name            text          not null default '',  -- 号名
  purchase_price  numeric(14,2) not null default 0,   -- 号本身的购入成本
  purchase_date   date,
  sold            boolean       not null default false,
  sale_price      numeric(14,2) not null default 0,
  sale_net        numeric(14,2),                      -- 手填到手价（可空，空则按费率算）
  sale_date       date,
  sold_zone       text          not null default '',
  note            text          not null default '',
  created_at      timestamptz   not null default now()
);

-- 固定资产 —— 号里陆续买入的东西，挂 char_id 指向所属号（空 = 未归号）。
-- 完全独立于倒卖核算：不计入投入 / 回款 / 盈亏，只归集「购入总成本」。
-- sold 系列字段同 chars：卖了只标记、保留记录。
create table if not exists public.assets (
  id              text primary key,
  owner           uuid default auth.uid(),
  char_id         text references public.chars(id) on delete set null,
  name            text          not null default '',
  category        text          not null default 'equipment',
  sub_category    text          not null default '',   -- 二级分类，非必填
  cost            numeric(14,2) not null default 0,   -- 购入成本
  purchase_date   date,
  cross_server    boolean       not null default false,  -- 跨服购买，180 天时间锁
  sold            boolean       not null default false,
  sale_price      numeric(14,2) not null default 0,
  sale_net        numeric(14,2),
  sale_date       date,
  sold_zone       text          not null default '',
  note            text          not null default '',
  created_at      timestamptz   not null default now()
);

-- ---------------------------------------------------------------- 兼容旧版
-- 如果之前跑过更早版本的脚本（表已经建出来，用的还是 zone_id / sold_zone_id 字段），
-- 下面的幂等语句会把结构补齐到当前版本，避免建索引时报「column zone does not exist」。
-- 旧数据怎么从 zones 表搬过来，见文件末尾「旧版迁移」。
alter table public.roles    add column if not exists owner     uuid default auth.uid();
alter table public.products add column if not exists owner     uuid default auth.uid();
alter table public.assets   add column if not exists owner     uuid default auth.uid();
alter table public.chars    add column if not exists owner     uuid default auth.uid();
alter table public.roles    add column if not exists zone      text not null default '';
alter table public.roles    add column if not exists sold_zone text not null default '';
alter table public.products add column if not exists zone      text not null default '';
alter table public.products add column if not exists sold_zone text not null default '';
alter table public.assets   add column if not exists char_id   text;
alter table public.assets   add column if not exists cross_server boolean not null default false;
alter table public.products add column if not exists sub_category text not null default '';
alter table public.assets   add column if not exists sub_category text not null default '';
alter table public.products add column if not exists from_asset boolean not null default false;

-- 固定资产「已售」标记（卖掉的号/物品保留记录，只标记，可撤销）
alter table public.chars    add column if not exists sold       boolean       not null default false;
alter table public.chars    add column if not exists sale_price numeric(14,2) not null default 0;
alter table public.chars    add column if not exists sale_net   numeric(14,2);
alter table public.chars    add column if not exists sale_date  date;
alter table public.chars    add column if not exists sold_zone  text          not null default '';
alter table public.assets   add column if not exists sold       boolean       not null default false;
alter table public.assets   add column if not exists sale_price numeric(14,2) not null default 0;
alter table public.assets   add column if not exists sale_net   numeric(14,2);
alter table public.assets   add column if not exists sale_date  date;
alter table public.assets   add column if not exists sold_zone  text          not null default '';

-- ---------------------------------------------------------------- 索引

create index if not exists roles_owner_idx     on public.roles(owner);
create index if not exists products_owner_idx  on public.products(owner);
create index if not exists assets_owner_idx    on public.assets(owner);
create index if not exists chars_owner_idx     on public.chars(owner);
create index if not exists assets_char_idx     on public.assets(char_id);
create index if not exists roles_zone_idx      on public.roles(zone);
create index if not exists products_zone_idx   on public.products(zone);
create index if not exists products_role_idx   on public.products(role_id);

-- ---------------------------------------------------------------- 权限

grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.roles    enable row level security;
alter table public.products enable row level security;
alter table public.assets   enable row level security;
alter table public.chars    enable row level security;

-- 清掉可能存在的旧策略。
-- 注意：drop policy 的 if exists 只对「策略」生效 —— 若表本身不存在，
-- 对着它 drop policy 仍会报 42P01，所以这里只列当前版本实际存在的四张表。
drop policy if exists "app full access" on public.roles;
drop policy if exists "app full access" on public.products;
drop policy if exists "app full access" on public.assets;
drop policy if exists "app full access" on public.chars;
drop policy if exists "own rows" on public.roles;
drop policy if exists "own rows" on public.products;
drop policy if exists "own rows" on public.assets;
drop policy if exists "own rows" on public.chars;

-- 只允许登录用户操作自己的数据；anon 没有任何权限
create policy "own rows" on public.roles
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

create policy "own rows" on public.products
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

create policy "own rows" on public.assets
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

create policy "own rows" on public.chars
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());


-- ============================================================================
--  接下来建议做的两件事（都在 Supabase 控制台点一下就行）
-- ============================================================================

-- ① 关掉「谁都能自己注册」（强烈建议）
--
--   Authentication → Sign In / Providers → Email
--     关掉 "Allow new users to sign up"
--     关掉 "Confirm email"（自己的系统，省掉邮箱验证这一步，登录更顺）
--
--   然后 Authentication → Users → Add user，手工建你自己的账号：
--     Email: 你的邮箱
--     Password: 你的密码
--     勾选 "Auto Confirm User"
--
--   建完之后回到前台登录页，用这个邮箱密码登录即可。


-- ② 如果你之前用旧版脚本建过 zones 表 / 录过数据
--
--   旧版有个独立的 zones 表、且角色/商品上用的是 zone_id / sold_zone_id 字段。
--   新版不再需要它。迁移脚本（有数据才需要跑，全新项目直接跳过）：
--
--     -- 先把旧字段的数据搬到新字段
--     update public.roles
--       set zone    = coalesce((select name from public.zones where id = roles.zone_id), ''),
--           sold_zone = coalesce((select name from public.zones where id = roles.sold_zone_id), '');
--     alter table public.roles drop column if exists zone_id, drop column if exists sold_zone_id;
--
--     update public.products
--       set zone = coalesce((select name from public.zones where id = products.zone_id), ''),
--           sold_zone = coalesce((select name from public.zones where id = products.sold_zone_id), '');
--     alter table public.products drop column if exists zone_id, drop column if exists sold_zone_id;
--
--     -- zones 表不再被引用，想删就删
--     drop table if exists public.zones;
--
--   旧数据的 owner 如果是 NULL，还要执行认领：
--
--     update public.roles    set owner = (select id from auth.users where email = '你@邮箱') where owner is null;
--     update public.products set owner = (select id from auth.users where email = '你@邮箱') where owner is null;


-- ③ 顺手验证策略是否生效（可选）
--
--   应返回 4 行（roles / products / assets / chars），roles 里只有 authenticated：
--
--     select tablename, policyname, cmd, roles
--     from pg_policies
--     where schemaname = 'public' and tablename in ('roles','products','assets','chars');
-- ============================================================================
