import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

interface CampoConfig { key: string; type: string; required?: boolean; default?: string }
interface Contribuicao { id: string; type: string; url?: string; visibility?: { userTypes?: number[] } }
interface Manifest {
  manifestVersion: number;
  id: string;
  version: string;
  name: string;
  config: CampoConfig[];
  contributions: Contribuicao[];
}

const DIR = path.join(__dirname, '..', '..', 'extension');
const ler = (ext: string): Manifest => JSON.parse(readFileSync(path.join(DIR, ext, 'manifest.json'), 'utf8'));
const campo = (m: Manifest, chave: string) => m.config.find((c) => c.key === chave);

describe.each(['atendimento', 'admin'])('manifest da extensão %s', (ext) => {
  const m = ler(ext);

  it('segue as regras de formato da Kentro', () => {
    expect(m.manifestVersion).toBe(1);
    expect(m.id).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.name).toBeTruthy();
    expect(m.contributions.length).toBeGreaterThan(0);
  });

  it('toda url de contribuição aponta para um arquivo existente', () => {
    for (const c of m.contributions) {
      expect(c.url).toBeTruthy();
      expect(existsSync(path.join(DIR, ext, c.url!))).toBe(true);
    }
  });

  it('api_url é obrigatório e vem preenchido com a URL pública', () => {
    expect(campo(m, 'api_url')).toMatchObject({ type: 'url', required: true, default: '__URL_PUBLICA__' });
  });
});

describe('separação admin / atendimento', () => {
  it('admin: só Configurações, visível só para administradores, com chave_admin secreta', () => {
    const m = ler('admin');
    expect(m.id).toBe('kentro.shop-admin');
    expect(m.contributions).toHaveLength(1);
    expect(m.contributions[0]).toMatchObject({ type: 'topMenu', visibility: { userTypes: [0] } });
    expect(campo(m, 'chave_admin')).toMatchObject({ type: 'secret' });
  });

  it('atendimento: só o painel, com chave_atendimento secreta e obrigatória', () => {
    const m = ler('atendimento');
    expect(m.id).toBe('kentro.shop');
    expect(m.contributions).toHaveLength(1);
    expect(m.contributions[0].type).toBe('chatPanel');
    expect(campo(m, 'chave_atendimento')).toMatchObject({ type: 'secret', required: true });
  });
});
