create or replace function public.reconcile_purchase_subtotal_from_products()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid := coalesce(new.purchase_id, old.purchase_id);
  v_product_count integer;
  v_priced_count integer;
  v_product_total numeric;
  v_purchase_total numeric;
  v_shipping numeric;
  v_discount numeric;
  v_purchase_currency text;
  v_currency_mismatches integer;
begin
  select count(*)::integer,
         count(total_price)::integer,
         coalesce(sum(total_price), 0)
    into v_product_count, v_priced_count, v_product_total
  from public.products
  where purchase_id = v_purchase_id;

  if v_product_count = 0 or v_product_count <> v_priced_count then
    return coalesce(new, old);
  end if;

  select total_amount,
         coalesce(shipping_amount, 0),
         coalesce(discount_amount, 0),
         currency
    into v_purchase_total, v_shipping, v_discount, v_purchase_currency
  from public.purchases
  where id = v_purchase_id;

  if v_purchase_total is null then
    return coalesce(new, old);
  end if;

  select count(*)::integer
    into v_currency_mismatches
  from public.products
  where purchase_id = v_purchase_id
    and currency is not null
    and v_purchase_currency is not null
    and upper(currency) <> upper(v_purchase_currency);

  if v_currency_mismatches > 0 then
    return coalesce(new, old);
  end if;

  if abs((v_product_total + v_shipping - v_discount) - v_purchase_total) <= 0.01 then
    update public.purchases
    set subtotal = v_product_total
    where id = v_purchase_id
      and subtotal is distinct from v_product_total;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_reconcile_purchase_subtotal_from_products on public.products;
create trigger trg_reconcile_purchase_subtotal_from_products
after insert or update of total_price, currency, purchase_id or delete
on public.products
for each row execute function public.reconcile_purchase_subtotal_from_products();

with product_sums as (
  select purchase_id,
         count(*)::integer as product_count,
         count(total_price)::integer as priced_count,
         sum(total_price) as product_total,
         count(*) filter (where currency is not null)::integer as currency_count,
         count(distinct upper(currency)) filter (where currency is not null)::integer as distinct_currency_count,
         max(upper(currency)) filter (where currency is not null) as product_currency
  from public.products
  group by purchase_id
)
update public.purchases p
set subtotal = ps.product_total
from product_sums ps
where p.id = ps.purchase_id
  and ps.product_count > 0
  and ps.product_count = ps.priced_count
  and ps.product_total is not null
  and (ps.currency_count = 0 or ps.distinct_currency_count = 1)
  and (ps.product_currency is null or p.currency is null or ps.product_currency = upper(p.currency))
  and p.total_amount is not null
  and abs((ps.product_total + coalesce(p.shipping_amount,0) - coalesce(p.discount_amount,0)) - p.total_amount) <= 0.01
  and p.subtotal is distinct from ps.product_total;
