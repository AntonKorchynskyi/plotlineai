-- Gallery cards render in a deliberate order on the landing page; without an explicit
-- column the order would depend on identity assignment, which upserts do not preserve.
alter table gallery_example
    add column display_order int not null default 0;
