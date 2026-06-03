-- 统一邮箱大小写，避免同邮箱因大小写不同产生重复用户
UPDATE users SET email = lower(trim(email)) WHERE email IS NOT NULL;
