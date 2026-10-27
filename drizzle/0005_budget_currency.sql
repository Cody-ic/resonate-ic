ALTER TABLE ai_calls ADD currency text NOT NULL DEFAULT 'USD';
CREATE INDEX ai_calls_currency_month_lane ON ai_calls(currency,created_at,lane);
