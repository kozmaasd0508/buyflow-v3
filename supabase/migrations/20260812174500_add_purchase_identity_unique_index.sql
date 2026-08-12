create unique index if not exists purchases_user_merchant_order_unique
on public.purchases (user_id, lower(merchant_domain), lower(order_number))
where merchant_domain is not null and order_number is not null;
