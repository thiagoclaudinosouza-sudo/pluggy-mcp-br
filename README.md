# pluggy-mcp-br

Read-only MCP server that gives an agent access to Brazilian bank data through [Pluggy](https://pluggy.ai), on the free [Meu Pluggy](https://meu.pluggy.ai) plan.

## Setup

Deploy on Vercel and set the variables from [`.env.example`](.env.example). The MCP URL is `https://<your-domain>/mcp`.

## Tools

`list_accounts` · `get_balances` · `list_transactions` · `list_card_bills` · `spending_by_category` · `connection_status` · `current_bill` · `spending_room` · `monthly_summary` · `list_investments` · `refresh_data` (asks Pluggy for a new sync, at most once per hour per item)

## License

MIT.


## Widget do iPhone (`/widget`)

`GET /widget` com `Authorization: Bearer <WIDGET_TOKEN>` devolve só o resumo do mês (quanto ainda dá para gastar das metas variáveis, por categoria). Não devolve transações e não muda nada. Sem `WIDGET_TOKEN` (mínimo 24 caracteres) nas variáveis de ambiente, o endereço fica desligado (503). Usado pelo script do Scriptable no iPhone.
