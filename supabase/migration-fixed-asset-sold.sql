-- ============================================================
-- 增量升级：固定资产支持「标记已售」（不删记录，可撤销）
--
-- 用法：Supabase → SQL Editor → 新建查询 → 整段粘贴 → Run
--
-- 全部是 add column if not exists，重复执行安全，
-- 不会动已有数据（老记录默认 sold = false，即「还在手上」）。
-- 跑完之后固定资产页每个号 / 物品才会多出「售出」按钮的效果。
-- ============================================================

-- 自玩号：卖出后保留记录，只打标记
alter table public.chars  add column if not exists sold       boolean       not null default false;
alter table public.chars  add column if not exists sale_price numeric(14,2) not null default 0;
alter table public.chars  add column if not exists sale_net   numeric(14,2);
alter table public.chars  add column if not exists sale_date  date;
alter table public.chars  add column if not exists sold_zone  text          not null default '';

-- 号内物品：同上
alter table public.assets add column if not exists sold       boolean       not null default false;
alter table public.assets add column if not exists sale_price numeric(14,2) not null default 0;
alter table public.assets add column if not exists sale_net   numeric(14,2);
alter table public.assets add column if not exists sale_date  date;
alter table public.assets add column if not exists sold_zone  text          not null default '';

-- 校验：下面两句应该各返回 5 行
-- select column_name, data_type from information_schema.columns
--   where table_name = 'chars'  and column_name in ('sold','sale_price','sale_net','sale_date','sold_zone');
-- select column_name, data_type from information_schema.columns
--   where table_name = 'assets' and column_name in ('sold','sale_price','sale_net','sale_date','sold_zone');
