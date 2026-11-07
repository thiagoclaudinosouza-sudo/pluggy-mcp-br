import { timingSafeEqual } from 'node:crypto';
import { createBankingSource } from '../banking/source';
import { calendarDay, isOutflow, type BankingSource } from '../banking/types';
import type { EnvLike } from '../config';

/**
 * Read-only summary for the iPhone widget (Scriptable): how much of the monthly
 * variable budget is left. Same rules as the "Finanças Floripa" dashboard.
 * Protected by WIDGET_TOKEN. Returns only totals, never transactions.
 */

const METAS: Record<string, { meta: number; emoji: string }> = {
  Mercado: { meta: 1200, emoji: '🛒' },
  'Comer fora e iFood': { meta: 400, emoji: '🍔' },
  Transporte: { meta: 200, emoji: '🚗' },
  Saúde: { meta: 100, emoji: '💊' },
  'Cuidados pessoais': { meta: 100, emoji: '💈' },
  Lavanderia: { meta: 80, emoji: '👕' },
};

/** Purchases split by hand on the dashboard (part of one purchase counted in another category). */
const DIVISOES: { transacao: string; valor: number; categoria: string }[] = [
  { transacao: 'a75eb901-954a-4631-b0e2-df99a23f6e8c', valor: 8, categoria: 'Comer fora e iFood' },
];

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function categoria(description: string, category: string | null, isCard: boolean): string | null {
  const d = description.toUpperCase();
  const c = category ?? '';
  if (/SALDO EM (ATRASO|ROTATIVO)|SALDO ANTERIOR|PAGAMENTO RECEBIDO|PAGAMENTO DE FATURA/.test(d)) return null;
  let cat: string | null = null;
  if (/ANTHROPIC|CLAUDE SUB|ADOBE|YOUTUBE ?PREMIUM|GOOGLE ?ONE|DL\*GOOGLE|APPLE\.COM\/BILL|NETFLIX|SPOTIFY|DISNEY|CANVA|ARTLIST/.test(d)) cat = 'Assinaturas';
  else if (/^IOF|TARIFA|ANUIDADE|JUROS|MULTA/.test(d) || /Tax on financial|Late payment|Credit card fees/i.test(c)) cat = 'Juros';
  else if (/VIVO|TELEFONICA/.test(d)) cat = 'Celular';
  else if (/IFD\*|IFOOD/.test(d)) cat = 'Comer fora e iFood';
  else if (/UBER|99 ?APP|99 ?TAXI|99POP|\bJET\b|JET\*|JETSHR|PATINET|SCOOTER|WHOOSH|BIRD RIDES/.test(d) || /Taxi|Bicycle|Public transport/i.test(c)) cat = 'Transporte';
  else if (/PURE WASH/.test(d)) cat = 'Lavanderia';
  else if (/MERCADOLIVRE|MERCADO\*|AMAZON|SHOPEE|ALIEXPRESS|MAGAZINE LUIZA/.test(d)) cat = 'Compras';
  else if (/ELETRO|\b\d{1,2}\/\d{1,2}\b/.test(d)) cat = 'Compras';
  else if (/Groceries|Supermarket/i.test(c)) cat = 'Mercado';
  else if (/Pharmac|Health|Hospital|Dentist/i.test(c)) cat = 'Saúde';
  else if (/Restaurant|Eating|Food|Bar|Coffee|Fast food/i.test(c)) cat = 'Comer fora e iFood';
  else if (/Hair|Beauty|Barber/i.test(c) || /BARBER/.test(d)) cat = 'Cuidados pessoais';
  if (!cat && !isCard) return null;
  return cat ?? 'Compras';
}

function hojeSaoPaulo(now: Date): { ano: number; mes: number; dia: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-');
  return { ano: Number(p[0]), mes: Number(p[1]), dia: Number(p[2]) };
}

function tokenOk(request: Request, env: EnvLike): boolean | null {
  const esperado = env.WIDGET_TOKEN?.trim() ?? '';
  if (esperado.length < 24) return null;
  const auth = request.headers.get('authorization') ?? '';
  const veio = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const a = Buffer.from(veio), b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleWidget(request: Request, env: EnvLike = process.env, now = new Date(), injected?: BankingSource): Promise<Response> {
  if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  const ok = tokenOk(request, env);
  if (ok === null) return Response.json({ error: 'widget_disabled', error_description: 'WIDGET_TOKEN is not set (min. 24 characters).' }, { status: 503 });
  if (!ok) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const source = injected ?? createBankingSource(env);
  const { ano, mes, dia } = hojeSaoPaulo(now);
  const mm = String(mes).padStart(2, '0');
  const from = `${ano}-${mm}-01`;
  const to = `${ano}-${mm}-${String(dia).padStart(2, '0')}`;
  const diasNoMes = new Date(ano, mes, 0).getDate();

  const accounts = await source.listAccounts();
  const cards = new Set(accounts.rows.filter((a) => /CREDIT/i.test(a.type)).map((a) => a.id));
  const txs = await source.listTransactions({ from, to });

  const gasto: Record<string, number> = Object.fromEntries(Object.keys(METAS).map((k) => [k, 0]));
  for (const t of txs.rows) {
    if (!isOutflow(t)) continue;
    const dt = calendarDay(t.date);
    if (dt < from || dt > to) continue;
    const isCard = cards.has(t.accountId);
    const cat = categoria(t.description ?? '', t.category, isCard);
    if (!cat) continue;
    let valor = Math.abs(t.amount);
    for (const p of DIVISOES.filter((x) => x.transacao === t.id)) {
      valor -= p.valor;
      if (p.categoria in gasto) gasto[p.categoria] += p.valor;
    }
    if (cat in gasto && valor > 0) gasto[cat] += valor;
  }

  const r2 = (x: number) => Math.round(x * 100) / 100;
  const meta = Object.values(METAS).reduce((s, m) => s + m.meta, 0);
  const total = r2(Object.values(gasto).reduce((s, v) => s + v, 0));
  const livre = r2(meta - total);
  const restantes = diasNoMes - dia + 1;
  const categorias = Object.entries(METAS)
    .map(([nome, m]) => ({ nome, emoji: m.emoji, gasto: r2(gasto[nome]), meta: m.meta }))
    .sort((a, b) => b.gasto / b.meta - a.gasto / a.meta);

  let atualizado: string | null = null;
  try {
    const items = await source.connectionStatus();
    const datas = items.map((i) => i.lastUpdatedAt).filter((x): x is string => !!x).sort();
    atualizado = datas[0] ?? null;
  } catch {
    atualizado = null;
  }

  const body = {
    mes: `${ano}-${mm}`,
    nome_mes: MESES[mes - 1],
    meta,
    gasto: total,
    livre,
    por_dia: r2(Math.max(0, livre) / restantes),
    dias_restantes: restantes,
    usado: meta > 0 ? r2(total / meta) : 0,
    ritmo_ideal: r2(dia / diasNoMes),
    categorias,
    bancos_atualizados_em: atualizado,
    gerado_em: now.toISOString(),
    truncado: txs.truncated || accounts.truncated || false,
  };
  return Response.json(body);
}
