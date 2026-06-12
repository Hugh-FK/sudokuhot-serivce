-- 默认错误上限 10 → 5
UPDATE user_settings
SET settings_json = json_set(settings_json, '$.mistakeLimit', '5')
WHERE json_extract(settings_json, '$.mistakeLimit') = '10';
