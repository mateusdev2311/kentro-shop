// Grava respostas reais da eCommerce-net para a bateria de contrato (spec 7.3).
// Uso (as credenciais ficam só nas variáveis de ambiente desta execução):
//   ECN_URL=https://.../api ECN_CLIENT_ID=... ECN_CLIENT_SECRET=... node scripts/gravar-fixtures-ecommercenet.mjs
// Opcional: ECN_BUSCA=palavra (padrão: primeira palavra do 1º produto).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = (process.env.ECN_URL ?? '').trim().replace(/\/+$/, '');
const id = process.env.ECN_CLIENT_ID ?? '';
const segredo = process.env.ECN_CLIENT_SECRET ?? '';
if (!base || !id || !segredo) {
  console.error('Informe ECN_URL, ECN_CLIENT_ID e ECN_CLIENT_SECRET.');
  process.exit(1);
}

const token = Buffer.from(`${id}:${segredo}`).toString('base64');
const FORMATOS = { puro: token, basic: `Basic ${token}` };

async function pedir(caminho, params, autorizacao) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  const resposta = await fetch(`${base}${caminho}${query.size ? `?${query}` : ''}`, {
    headers: { Accept: 'application/json', Authorization: autorizacao },
  });
  const texto = await resposta.text();
  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = texto;
  }
  return { status: resposta.status, corpo };
}

// 1. Descobre qual formato do cabeçalho Authorization a plataforma aceita.
let formato;
for (const [nome, valor] of Object.entries(FORMATOS)) {
  const r = await pedir('/product/all', { page: 1, limit: 1 }, valor);
  if (r.status === 200 && r.corpo?.success !== false) {
    formato = nome;
    break;
  }
}
if (!formato) {
  console.error('A plataforma recusou os dois formatos de Authorization. Confira o endereço e as credenciais.');
  process.exit(1);
}
const auth = FORMATOS[formato];
console.log(`Formato do Authorization aceito: ${formato}`);

// 2. Grava as respostas usadas pelos testes.
const gravado = { _sintetico: false, _gravadoEm: new Date().toISOString(), _formato: { authorization: formato } };
gravado.categorias = await pedir('/category/findbyname', {}, auth);
gravado['produtos-p1'] = await pedir('/product/all', { page: 1, limit: 24 }, auth);
gravado['produtos-p2'] = await pedir('/product/all', { page: 2, limit: 24 }, auth);

const produtos = gravado['produtos-p1'].corpo?.data?.products ?? [];
const busca = process.env.ECN_BUSCA || String(produtos[0]?.name ?? '').split(/\s+/)[0];
gravado.busca = await pedir('/product/all', { page: 1, limit: 24, search: busca }, auth);
gravado['busca-vazia'] = await pedir('/product/all', { page: 1, limit: 24, search: 'zzzzzz' }, auth);

const comVariacao = produtos.find((p) => String(p.type) === '4' || p.variety_title);
const simples = produtos.find((p) => p !== comVariacao);
if (simples) gravado['produto-simples'] = await pedir('/product/findBySku', { sku: simples.sku }, auth);
if (comVariacao) {
  gravado['produto-variacao'] = await pedir('/product/findBySku', { sku: comVariacao.sku }, auth);
  gravado.variacoes = await pedir('/product/findvarietybyproductskuv2', { product_sku: comVariacao.sku }, auth);
}
const referencia = (simples ?? comVariacao)?.sku;
if (referencia) {
  gravado['compre-junto'] = await pedir('/product/findbuyitwithbysku', { sku: referencia }, auth);
  gravado.relacionados = await pedir('/product/findRelatedBySku', { sku: referencia }, auth);
}
gravado['credencial-invalida'] = await pedir('/product/all', { page: 1, limit: 1 }, Buffer.from('invalido:invalido').toString('base64'));

const destino = join(import.meta.dirname, '..', 'api', 'test', 'conectores', 'fixtures', 'ecommercenet.gravado.json');
writeFileSync(destino, JSON.stringify(gravado, null, 2));

const campos = new Set(produtos.flatMap((p) => Object.keys(p)));
console.log(`Gravado em ${destino}`);
console.log(`Produtos na 1ª página: ${produtos.length}. Com variação: ${comVariacao ? comVariacao.sku : 'nenhum'}. Busca usada: "${busca}".`);
console.log(`Campos de produto encontrados: ${[...campos].sort().join(', ')}`);
console.log('Revise o arquivo: ele contém só dados de catálogo (públicos), sem cabeçalhos nem credenciais.');
