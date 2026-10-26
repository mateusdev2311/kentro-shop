import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { conectorAutomatiza } from '../src/conectores/automatiza/automatiza.conector';
import { AbrirBanco } from '../src/conectores/nucleo/banco';
import { CredencialInvalida } from '../src/conectores/nucleo/erros';
import { AbrirFtp } from '../src/conectores/nucleo/ftp';
import { FotosService } from '../src/integracoes/fotos.service';
import { SincronizacaoService } from '../src/integracoes/sincronizacao.service';
import { criarAppDeTeste } from './app';
import { bancoEmMemoria, CREDENCIAIS_BANCO } from './conectores/banco-memoria';
import { conectorFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

const jpeg = (marca: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marca)]);
const FTP = { ftp_host: 'arquivos.loja.teste', ftp_porta: '6785', ftp_usuario: 'Kentro', ftp_senha: 'certa', ftp_pasta: '/Banco de imagens' };

describe('fotos dos produtos copiadas do FTP da loja', () => {
  let app: INestApplication;
  let loja: { lojaId: string; chaveAdmin: string; chaveAtendimento: string };
  /** O FTP falso: nome -> conteúdo e data. */
  let arquivos: Map<string, { bytes: Buffer; modificadoEm: string }>;
  let baixados: string[];
  const abrirBanco: AbrirBanco = (o) => bancoEmMemoria(o.credenciais);
  const abrirFtp: AbrirFtp = async (c) => {
    if (c.senha !== 'certa') throw new CredencialInvalida();
    expect(c).toMatchObject({ host: 'arquivos.loja.teste', porta: 6785, pasta: '/Banco de imagens' });
    return {
      listar: async () => [...arquivos].map(([nome, a]) => ({ nome, tamanho: a.bytes.length, modificadoEm: a.modificadoEm })),
      baixar: async (nome) => {
        baixados.push(nome);
        return arquivos.get(nome)!.bytes;
      },
      fechar: () => undefined,
    };
  };

  const http = () => request(app.getHttpServer());
  const admin = (r: request.Test) => r.set('X-Loja-Chave', loja.chaveAdmin);
  const salvar = (credenciais: object) => admin(http().put('/v1/loja/integracao')).send({ plataforma: 'automatiza', credenciais });
  const estado = async () => (await admin(http().get('/v1/loja/catalogo-sincronizado/fotos'))).body;
  const produto = async (id: string) => (await http().get(`/v1/loja/catalogo/produtos/${id}`).set('X-Loja-Chave', loja.chaveAtendimento)).body;
  /** "Buscar fotos agora" roda em segundo plano: espera terminar. */
  async function buscarFotos() {
    const r = await admin(http().post('/v1/loja/catalogo-sincronizado/fotos/sincronizar'));
    expect(r.status).toBe(202);
    for (let i = 0; i < 100 && (await estado()).sincronizando; i++) await new Promise((ok) => setTimeout(ok, 20));
  }

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { conectores: [conectorFalso, conectorAutomatiza], abrirBanco, abrirFtp });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    await prisma.fotoProduto.deleteMany();
    ipSeq += 1;
    loja = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.11.0.${ipSeq}`).send({ nome: 'Farmácia' })).body;
    baixados = [];
    arquivos = new Map([
      ['7890000000101.jpg', { bytes: jpeg('sabonete'), modificadoEm: '10-26-26 10:41AM' }],
      ['7890000000101_2.jpg', { bytes: jpeg('sabonete verso'), modificadoEm: '10-26-26 10:41AM' }],
      ['07890000000102.jpg', { bytes: jpeg('shampoo'), modificadoEm: '10-26-26 10:42AM' }], // EAN com zero à esquerda
      ['cod_103.jpg', { bytes: jpeg('dipirona'), modificadoEm: '10-26-26 10:43AM' }], // pelo código interno
      ['7890000000201.jpg', { bytes: jpeg('controlado'), modificadoEm: '10-26-26 10:44AM' }], // produto fora do catálogo
      ['7890000000104.jpg', { bytes: Buffer.from('não é imagem'), modificadoEm: '10-26-26 10:45AM' }],
      ['leiame.txt', { bytes: Buffer.from('texto'), modificadoEm: '10-26-26 10:46AM' }],
    ]);
    await salvar({ ...CREDENCIAIS_BANCO, ...FTP });
    await admin(http().post('/v1/loja/catalogo-sincronizado/sincronizar'));
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('baixa só as fotos dos produtos do catálogo, liga pelo EAN ou código interno e serve em https com cache', async () => {
    expect(await estado()).toMatchObject({ configurado: true, sincronizando: false, comFoto: 0, semFoto: 5, sincronizadasEm: null });

    await buscarFotos();
    expect(baixados.sort()).toEqual(['07890000000102.jpg', '7890000000101.jpg', '7890000000101_2.jpg', '7890000000104.jpg', 'cod_103.jpg']);
    expect(await estado()).toMatchObject({ comFoto: 3, semFoto: 2, erro: null, sincronizadasEm: expect.any(String) });

    const sabonete = await produto('101');
    expect(sabonete.imagens).toEqual([
      expect.stringMatching(/^https:\/\/shop\.teste\/v1\/publico\/fotos\/[a-f0-9]{40}\.jpg$/),
      expect.stringMatching(/^https:\/\/shop\.teste\/v1\/publico\/fotos\/[a-f0-9]{40}\.jpg$/),
    ]);
    expect((await produto('102')).imagens).toHaveLength(1);
    expect((await produto('103')).imagens).toHaveLength(1);
    expect((await produto('104')).imagens).toEqual([]); // o arquivo não era imagem

    const foto = await http().get(new URL(sabonete.imagens[0]).pathname);
    expect(foto.status).toBe(200);
    expect(foto.headers['content-type']).toBe('image/jpeg');
    expect(foto.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(foto.body).equals(jpeg('sabonete'))).toBe(true);
    expect((await http().get('/v1/publico/fotos/naoexiste.jpg')).status).toBe(404);
  });

  it('a próxima leitura só baixa o que mudou; foto que sai do FTP sai do produto; o catálogo renovado mantém as fotos', async () => {
    await buscarFotos();
    const antes = (await produto('102')).imagens[0];

    baixados = [];
    await buscarFotos();
    expect(baixados).toEqual([]); // nada mudou

    arquivos.set('07890000000102.jpg', { bytes: jpeg('shampoo novo'), modificadoEm: '10-27-26 09:00AM' });
    arquivos.delete('cod_103.jpg');
    await buscarFotos();
    expect(baixados).toEqual(['07890000000102.jpg']);
    const depois = (await produto('102')).imagens[0];
    expect(depois).not.toBe(antes); // conteúdo novo, URL nova (o cache antigo não serve a foto velha)
    expect((await produto('103')).imagens).toEqual([]);

    // A cópia do catálogo é trocada a cada 15 minutos: as fotos continuam.
    await admin(http().post('/v1/loja/catalogo-sincronizado/sincronizar'));
    expect((await produto('101')).imagens).toHaveLength(2);
    expect((await produto('102')).imagens).toEqual([depois]);
  });

  it('lista os produtos sem foto com o código de barras (o nome do arquivo que falta)', async () => {
    await buscarFotos();
    const r = await admin(http().get('/v1/loja/catalogo-sincronizado/fotos/sem-foto'));
    expect(r.body).toEqual([
      { id: '105', nome: 'HIDRATANTE FACIAL 50G', codigoBarras: '7890000000105' },
      { id: '104', nome: 'PROTETOR SOLAR FPS50 120ML', codigoBarras: '7890000000104' },
    ]);
  });

  it('senha errada no FTP: o motivo fica no estado e as fotos já copiadas continuam', async () => {
    await buscarFotos();
    await salvar({ ...CREDENCIAIS_BANCO, ...FTP, senha: '••••', ftp_senha: 'errada' });
    await expect(app.get(FotosService).sincronizar(loja.lojaId)).rejects.toMatchObject({ codigo: 'CREDENCIAL_INVALIDA' });
    expect(await estado()).toMatchObject({ comFoto: 3, erro: 'A plataforma recusou as credenciais. Confira os dados da integração.' });
  });

  it('trocar o servidor do FTP pede de novo só a senha do FTP (a do banco não muda de destino)', async () => {
    const r = await salvar({ ...CREDENCIAIS_BANCO, ...FTP, senha: '••••', ftp_senha: '••••', ftp_host: 'outro.loja.teste' });
    expect(r.status).toBe(400);
    expect(r.body.erro.mensagem).toBe('Ao trocar o endereço, digite de novo: Fotos: senha do FTP.');
    expect((await salvar({ ...CREDENCIAIS_BANCO, ...FTP, senha: '••••', ftp_senha: '••••', ftp_pasta: '/Banco de imagens' })).status).toBe(200);
  });

  it('sem FTP configurado: não busca e explica', async () => {
    await salvar(CREDENCIAIS_BANCO);
    expect((await estado()).configurado).toBe(false);
    const r = await admin(http().post('/v1/loja/catalogo-sincronizado/fotos/sincronizar'));
    expect(r.status).toBe(409);
    expect(r.body.erro.codigo).toBe('SEM_FTP');
  });

  it('a rodada automática busca as fotos vencidas depois do catálogo', async () => {
    await app.get(SincronizacaoService).rodada(Date.now() + 16 * 60_000);
    expect(await estado()).toMatchObject({ comFoto: 3, sincronizadasEm: expect.any(String) });
    baixados = [];
    await app.get(SincronizacaoService).rodada(Date.now() + 30 * 60_000); // as fotos ainda valem (1 hora)
    expect(baixados).toEqual([]);
  });
});
